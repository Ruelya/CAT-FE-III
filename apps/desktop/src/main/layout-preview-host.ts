import { createHmac, randomBytes, createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, extname, join } from "node:path";

import { isPathInside, resolveCanonicalPath } from "./path-safety.js";

export const LAYOUT_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;

export type LayoutDocumentType = "word" | "cell" | "slide";

export interface LayoutPreviewSink {
  outputPath: string;
}

export interface LayoutPreviewSession {
  fileUrl: string;
  docsUrl: string | null;
  token: string | null;
  documentType: LayoutDocumentType;
  fileType: string;
  title: string;
  key: string;
}

export function sanitizeLayoutFileType(fileType: string): string {
  const trimmed = fileType.trim().replace(/^\./, "").toLowerCase();
  return /^[a-z0-9]{1,8}$/u.test(trimmed) ? trimmed : "bin";
}

export function layoutDocumentType(fileType: string): LayoutDocumentType {
  const ext = sanitizeLayoutFileType(fileType);
  if (["xlsx", "xls", "csv", "ods"].includes(ext)) return "cell";
  if (["pptx", "ppt", "odp"].includes(ext)) return "slide";
  return "word";
}

export function readLayoutPreviewEnv(env: NodeJS.ProcessEnv = process.env): {
  docsUrl: string | null;
  jwtSecret: string | null;
} {
  const docsUrl = env.TRANSLUNAR_ONLYOFFICE_DOCS_URL?.trim() || null;
  const jwtSecret = env.TRANSLUNAR_ONLYOFFICE_JWT_SECRET?.trim() || null;
  return { docsUrl, jwtSecret };
}

function base64Url(value: Buffer | string): string {
  const buffer = typeof value === "string" ? Buffer.from(value) : value;
  return buffer
    .toString("base64")
    .replaceAll("=", "")
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}

/** HS256 JWT. The secret never leaves this function. */
export function signHs256Jwt(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const signature = createHmac("sha256", secret).update(data).digest();
  return `${data}.${base64Url(signature)}`;
}

export function buildOnlyOfficePayload(session: {
  fileUrl: string;
  documentType: LayoutDocumentType;
  fileType: string;
  title: string;
  key: string;
}): Record<string, unknown> {
  return {
    documentType: session.documentType,
    document: {
      fileType: session.fileType,
      key: session.key,
      title: session.title,
      url: session.fileUrl,
    },
    editorConfig: {
      mode: "view",
      lang: "zh",
    },
  };
}

export class LayoutPreviewHost {
  #server: Server | null = null;
  #port = 0;
  #token: string | null = null;
  #filePath: string | null = null;
  #fileName: string | null = null;

  constructor(
    private readonly createToken: () => string = () =>
      randomBytes(32).toString("hex"),
  ) {}

  async createSink(rootDir: string, fileType: string): Promise<LayoutPreviewSink> {
    const root = resolveCanonicalPath(rootDir);
    await mkdir(root, { recursive: true });
    const ext = sanitizeLayoutFileType(fileType);
    const outputPath = join(root, `${this.createToken()}.${ext}`);
    if (!isPathInside(root, outputPath)) {
      throw new Error("Layout preview sink escaped the preview root.");
    }
    return { outputPath };
  }

  async publish(input: {
    rootDir: string;
    outputPath: string;
    title: string;
    fileType: string;
    docsUrl: string | null;
    jwtSecret: string | null;
  }): Promise<LayoutPreviewSession> {
    const root = resolveCanonicalPath(input.rootDir);
    const outputPath = resolveCanonicalPath(input.outputPath);
    if (!isPathInside(root, outputPath)) {
      throw new Error("Layout preview file is outside the preview root.");
    }
    const info = await stat(outputPath);
    if (!info.isFile()) {
      throw new Error("Layout preview path is not a file.");
    }
    if (info.size > LAYOUT_PREVIEW_MAX_BYTES) {
      throw new Error("Layout preview file exceeds the 64 MiB limit.");
    }
    await this.ensureServer();
    this.#token = this.createToken();
    this.#filePath = outputPath;
    this.#fileName = basename(outputPath);
    const fileType = sanitizeLayoutFileType(
      input.fileType || extname(outputPath).slice(1),
    );
    const documentType = layoutDocumentType(fileType);
    const fileUrl = `http://127.0.0.1:${this.#port}/${this.#token}/${encodeURIComponent(this.#fileName)}`;
    const key = createHash("sha256")
      .update(`${outputPath}:${info.mtimeMs}:${info.size}`)
      .digest("hex")
      .slice(0, 20);
    const title = input.title.trim() || this.#fileName;
    const session: LayoutPreviewSession = {
      fileUrl,
      docsUrl: input.docsUrl,
      token: null,
      documentType,
      fileType,
      title,
      key,
    };
    if (input.jwtSecret) {
      session.token = signHs256Jwt(buildOnlyOfficePayload(session), input.jwtSecret);
    }
    return session;
  }

  async revoke(): Promise<void> {
    this.#token = null;
    this.#filePath = null;
    this.#fileName = null;
    const server = this.#server;
    this.#server = null;
    this.#port = 0;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private async ensureServer(): Promise<void> {
    if (this.#server) return;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const parts = url.pathname.split("/").filter(Boolean);
      if (
        request.method !== "GET" ||
        parts.length !== 2 ||
        !this.#token ||
        !this.#filePath ||
        !this.#fileName ||
        parts[0] !== this.#token ||
        decodeURIComponent(parts[1] ?? "") !== this.#fileName
      ) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", contentTypeFor(this.#fileName));
      response.setHeader("Cache-Control", "no-store");
      createReadStream(this.#filePath).pipe(response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Layout preview server failed to bind."));
          return;
        }
        this.#port = address.port;
        this.#server = server;
        resolve();
      });
    });
  }
}

function contentTypeFor(name: string): string {
  const ext = extname(name).toLowerCase();
  if (ext === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (ext === ".pptx") {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}
