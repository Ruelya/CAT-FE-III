import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

export const PLUGIN_ASSET_SCHEME = "translunar-plugin";
export const PLUGIN_ASSET_SESSION_TTL_MS = 5 * 60 * 1_000;
export const PLUGIN_ASSET_MAX_BYTES = 4 * 1024 * 1024;

export const PLUGIN_DOCUMENT_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const MIME_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export interface PluginPanelAssetSource {
  ownerWebContentsId: number;
  pluginId: string;
  versionId: string;
  revision: number;
  contributionId: string;
  bridgeVersion: 1;
  packageRoot: string;
  surface: string;
}

export interface PluginAssetSessionView {
  sessionId: string;
  url: string;
  expiresAtMs: number;
  revision: number;
  bridgeVersion: 1;
}

interface PluginAssetSession extends PluginPanelAssetSource {
  id: string;
  canonicalRoot: string;
  canonicalSurface: string;
  canonicalSurfaceRoot: string;
  createdAtMs: number;
  expiresAtMs: number;
  state: "issued" | "binding" | "bound" | "revoked";
}

interface PluginAssetFileSystem {
  lstat(path: string): Promise<Stats>;
  readFile(path: string): Promise<Buffer>;
  realpath(path: string): Promise<string>;
}

interface IssueEpoch {
  global: bigint;
  owner: bigint;
  plugin: bigint;
}

const DEFAULT_FILE_SYSTEM: PluginAssetFileSystem = {
  lstat,
  readFile,
  realpath,
};

export class PluginAssetSessionRegistry {
  readonly #sessions = new Map<string, PluginAssetSession>();
  readonly #ownerEpochs = new Map<number, bigint>();
  readonly #pluginEpochs = new Map<string, bigint>();
  #globalEpoch = 0n;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly createToken: () => string = () =>
      randomBytes(32).toString("hex"),
    private readonly fileSystem: PluginAssetFileSystem = DEFAULT_FILE_SYSTEM,
  ) {}

  async issue(source: PluginPanelAssetSource): Promise<PluginAssetSessionView> {
    const sessionSource = { ...source };
    this.prune();
    validateIssueSource(sessionSource);
    const issueEpoch = this.snapshotIssueEpoch(sessionSource);
    const canonicalRoot = await this.fileSystem.realpath(
      sessionSource.packageRoot,
    );
    const canonicalSurface = await resolveAssetPath(
      canonicalRoot,
      sessionSource.surface,
      this.fileSystem,
    );
    if (extname(canonicalSurface).toLowerCase() !== ".html") {
      throw new Error("Plugin panel surface must be an HTML file.");
    }
    if (!this.isIssueEpochCurrent(sessionSource, issueEpoch)) {
      throw new Error("Plugin asset session request was revoked.");
    }
    let id = this.createToken();
    if (!/^[a-f0-9]{64}$/u.test(id)) {
      throw new Error(
        "Plugin asset session token generator returned an invalid token.",
      );
    }
    while (this.#sessions.has(id)) id = this.createToken();
    const createdAtMs = this.now();
    const session: PluginAssetSession = {
      ...sessionSource,
      id,
      canonicalRoot,
      canonicalSurface,
      canonicalSurfaceRoot: dirname(canonicalSurface),
      createdAtMs,
      expiresAtMs: createdAtMs + PLUGIN_ASSET_SESSION_TTL_MS,
      state: "issued",
    };
    this.#sessions.set(id, session);
    return {
      sessionId: id,
      url: `${PLUGIN_ASSET_SCHEME}://${id}/${encodePath(sessionSource.surface)}`,
      expiresAtMs: session.expiresAtMs,
      revision: sessionSource.revision,
      bridgeVersion: sessionSource.bridgeVersion,
    };
  }

  revoke(sessionId: string, ownerWebContentsId?: number): boolean {
    const session = this.#sessions.get(sessionId);
    if (!session || session.state === "revoked") return false;
    if (
      ownerWebContentsId !== undefined &&
      session.ownerWebContentsId !== ownerWebContentsId
    ) {
      return false;
    }
    session.state = "revoked";
    this.#sessions.delete(sessionId);
    return true;
  }

  revokeOwner(ownerWebContentsId: number): void {
    bumpEpoch(this.#ownerEpochs, ownerWebContentsId);
    for (const session of this.#sessions.values()) {
      if (session.ownerWebContentsId === ownerWebContentsId) {
        session.state = "revoked";
        this.#sessions.delete(session.id);
      }
    }
  }

  revokePlugin(pluginId: string, revision?: number): void {
    bumpEpoch(this.#pluginEpochs, pluginId);
    for (const session of this.#sessions.values()) {
      if (
        session.pluginId === pluginId &&
        (revision === undefined || session.revision !== revision)
      ) {
        session.state = "revoked";
        this.#sessions.delete(session.id);
      }
    }
  }

  revokeAll(): void {
    this.#globalEpoch += 1n;
    for (const session of this.#sessions.values()) session.state = "revoked";
    this.#sessions.clear();
  }

  async handle(request: Request): Promise<Response> {
    this.prune();
    if (request.method !== "GET" || request.headers.has("range")) {
      return denied(request.method === "GET" ? 416 : 405);
    }
    if (hasRawDotPathComponent(request.url)) return denied();
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return denied();
    }
    if (
      url.protocol !== `${PLUGIN_ASSET_SCHEME}:` ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      /%(?:2f|5c)/iu.test(url.pathname)
    ) {
      return denied();
    }
    const session = this.#sessions.get(url.hostname);
    if (
      !session ||
      session.state === "binding" ||
      session.state === "revoked"
    ) {
      return denied();
    }
    if (session.expiresAtMs <= this.now()) {
      this.revoke(session.id);
      return denied();
    }
    let requestedPath: string;
    try {
      if (!url.pathname.startsWith("/")) return denied();
      requestedPath = decodeURIComponent(url.pathname.slice(1));
    } catch {
      return denied();
    }
    const wasIssued = session.state === "issued";
    if (wasIssued) {
      if (requestedPath !== session.surface) return denied();
      session.state = "binding";
    }
    let response: Response | null = null;
    try {
      const filePath = await resolveAssetPath(
        session.canonicalRoot,
        requestedPath,
        this.fileSystem,
      );
      if (!isPathInside(session.canonicalSurfaceRoot, filePath)) {
        return denied();
      }
      const isEntryDocument = filePath === session.canonicalSurface;
      if (wasIssued ? !isEntryDocument : isEntryDocument) return denied();
      const mime = MIME_TYPES.get(extname(filePath).toLowerCase());
      if (!mime) return denied();
      const metadata = await this.fileSystem.lstat(filePath).catch(() => null);
      if (!metadata?.isFile() || metadata.size > PLUGIN_ASSET_MAX_BYTES) {
        return denied();
      }
      const body = await this.fileSystem.readFile(filePath).catch(() => null);
      if (!body || body.byteLength !== metadata.size) return denied();
      const expectedState = wasIssued ? "binding" : "bound";
      if (!this.isCurrentSession(session, expectedState)) return denied();
      response = new Response(body, {
        status: 200,
        headers: responseHeaders(mime),
      });
      if (wasIssued) session.state = "bound";
      return response;
    } catch {
      return denied();
    } finally {
      if (
        wasIssued &&
        response === null &&
        this.#sessions.get(session.id) === session &&
        session.state === "binding"
      ) {
        this.revoke(session.id);
      }
    }
  }

  private snapshotIssueEpoch(source: PluginPanelAssetSource): IssueEpoch {
    return {
      global: this.#globalEpoch,
      owner: this.#ownerEpochs.get(source.ownerWebContentsId) ?? 0n,
      plugin: this.#pluginEpochs.get(source.pluginId) ?? 0n,
    };
  }

  private isIssueEpochCurrent(
    source: PluginPanelAssetSource,
    epoch: IssueEpoch,
  ): boolean {
    return (
      this.#globalEpoch === epoch.global &&
      (this.#ownerEpochs.get(source.ownerWebContentsId) ?? 0n) ===
        epoch.owner &&
      (this.#pluginEpochs.get(source.pluginId) ?? 0n) === epoch.plugin
    );
  }

  private isCurrentSession(
    session: PluginAssetSession,
    state: "binding" | "bound",
  ): boolean {
    if (this.#sessions.get(session.id) !== session || session.state !== state) {
      return false;
    }
    if (session.expiresAtMs <= this.now()) {
      this.revoke(session.id);
      return false;
    }
    return true;
  }

  private prune(): void {
    const now = this.now();
    for (const session of this.#sessions.values()) {
      if (session.expiresAtMs <= now) {
        session.state = "revoked";
        this.#sessions.delete(session.id);
      }
    }
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot.length > 0 &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

async function resolveAssetPath(
  root: string,
  relativePath: string,
  fileSystem: PluginAssetFileSystem,
): Promise<string> {
  if (!isSafeRelativePath(relativePath))
    throw new Error("Invalid plugin asset path.");
  const candidate = resolve(root, ...relativePath.split("/"));
  const fromRoot = relative(root, candidate);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Plugin asset path escapes package root.");
  }
  let cursor = root;
  for (const component of relativePath.split("/")) {
    cursor = resolve(cursor, component);
    const metadata = await fileSystem.lstat(cursor);
    if (metadata.isSymbolicLink())
      throw new Error("Plugin assets cannot use links.");
  }
  const canonical = await fileSystem.realpath(candidate);
  const canonicalRelative = relative(root, canonical);
  if (
    !canonicalRelative ||
    canonicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(canonicalRelative)
  ) {
    throw new Error("Plugin asset resolved outside package root.");
  }
  return canonical;
}

function hasRawDotPathComponent(value: string): boolean {
  const schemeSeparator = value.indexOf("://");
  if (schemeSeparator < 0) return false;
  const pathStart = value.indexOf("/", schemeSeparator + 3);
  if (pathStart < 0) return false;
  const queryStart = value.indexOf("?", pathStart);
  const fragmentStart = value.indexOf("#", pathStart);
  const pathEnd = Math.min(
    queryStart < 0 ? value.length : queryStart,
    fragmentStart < 0 ? value.length : fragmentStart,
  );
  return value
    .slice(pathStart, pathEnd)
    .split("/")
    .some((component) => {
      try {
        const decoded = decodeURIComponent(component);
        return decoded === "." || decoded === "..";
      } catch {
        return false;
      }
    });
}

function bumpEpoch<Key>(epochs: Map<Key, bigint>, key: Key): void {
  epochs.set(key, (epochs.get(key) ?? 0n) + 1n);
}

function isSafeRelativePath(value: string): boolean {
  if (
    value.length < 1 ||
    value.length > 512 ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/")
  ) {
    return false;
  }
  return value
    .split("/")
    .every(
      (component) =>
        component.length > 0 &&
        component !== "." &&
        component !== ".." &&
        !hasControlCharacters(component),
    );
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

function validateIssueSource(source: PluginPanelAssetSource): void {
  if (
    !Number.isSafeInteger(source.ownerWebContentsId) ||
    source.ownerWebContentsId < 1 ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 0 ||
    source.bridgeVersion !== 1 ||
    !isSafeRelativePath(source.surface) ||
    !source.pluginId ||
    !source.versionId ||
    !source.contributionId
  ) {
    throw new Error("Invalid plugin asset session request.");
  }
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function responseHeaders(mime: string): Headers {
  return new Headers({
    "content-type": mime,
    "content-security-policy": PLUGIN_DOCUMENT_CSP,
    "x-content-type-options": "nosniff",
    "cache-control": "no-store, max-age=0",
    "referrer-policy": "no-referrer",
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
  });
}

function denied(status = 404): Response {
  return new Response("Not found.", {
    status,
    headers: responseHeaders("text/plain; charset=utf-8"),
  });
}
