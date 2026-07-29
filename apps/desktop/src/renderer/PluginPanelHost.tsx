import { useEffect, useRef, useState } from "react";

import { useLocale } from "./i18n/LocaleProvider";
import type { MessageKey } from "./i18n/messages";

const BRIDGE_VERSION = 1;
const BRIDGE_MAX_BYTES = 256 * 1024;
const BRIDGE_MAX_DEPTH = 16;
const BRIDGE_MAX_NODES = 4_096;
const BRIDGE_MAX_STRING_LENGTH = BRIDGE_MAX_BYTES;
const BRIDGE_MAX_KEY_LENGTH = 256;
const BRIDGE_MAX_ARRAY_ITEMS = 4_096;
const BRIDGE_MAX_OBJECT_ENTRIES = 1_024;
const BRIDGE_TIMEOUT_MS = 3_000;
const MAX_PENDING_REQUESTS = 32;

type PanelBridgeMethod =
  | "panel.context"
  | "panel.activeSelection"
  | "panel.projectContext"
  | "panel.proposeReplacement";

type PanelMessage =
  | { version: 1; type: "ready"; nonce: string }
  | {
      version: 1;
      type: "request";
      id: string;
      method: PanelBridgeMethod;
      params: Record<string, unknown>;
    }
  | { version: 1; type: "cancel"; id: string };

type PanelStatus = "loading" | "connecting" | "ready" | "error" | "revoked";
type BridgeCloseReason =
  | "host_closed"
  | "navigation"
  | "protocol_error"
  | "request_timeout"
  | "session_revoked";

export interface PanelBridgePort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

interface PanelBridgeOptions {
  port: PanelBridgePort;
  nonce: string;
  context: {
    pluginId: string;
    contributionId: string;
    revision: number;
  };
  result: {
    pluginName: string;
    contributionName: string;
    revision: number;
  };
  /** Full owner token for Engine-owned bridge authorization. */
  owner: {
    pluginId: string;
    versionId: string;
    activationRevision: number;
    contributionId: string;
  };
  /** Closed methods declared on the panel descriptor; defaults to panel.context only. */
  allowedMethods?: readonly PanelBridgeMethod[];
  /** Identifiers only — Engine derives bounded context from store. */
  projectId?: string;
  segmentId?: string;
  /**
   * Test-only bridge resolver. Production always uses Engine RPC and never
   * falls back to renderer-local results.
   */
  resolveForTest?: (
    method: PanelBridgeMethod,
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  onReady(): void;
  onClosed(reason: BridgeCloseReason): void;
  scheduleTimeout?: (callback: () => void, delay: number) => number;
  clearScheduledTimeout?: (timer: number) => void;
  queueTask?: (callback: () => void) => void;
}

export interface PanelBridge {
  close(reason: BridgeCloseReason): void;
  isClosed(): boolean;
}

interface PanelSessionLifecycle {
  bridge: PanelBridge | null;
  closed: boolean;
  disposed: boolean;
  expiryTimer: number | undefined;
  loadCount: number;
  sessionId: string | null;
  close(next: "error" | "revoked", reason: BridgeCloseReason): void;
}

interface PluginPanelHostProps {
  pluginId: string;
  pluginName: string;
  contributionId: string;
  contributionName: string;
  revision: number;
  versionId?: string;
  allowedMethods?: readonly PanelBridgeMethod[];
  projectId?: string;
  segmentId?: string;
  onClose(): void;
}

export function PluginPanelHost({
  pluginId,
  pluginName,
  contributionId,
  contributionName,
  revision,
  versionId = "",
  allowedMethods = ["panel.context"],
  projectId,
  segmentId,
  onClose,
}: PluginPanelHostProps) {
  const { t } = useLocale();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lifecycleRef = useRef<PanelSessionLifecycle | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [status, setStatus] = useState<PanelStatus>("loading");

  useEffect(() => {
    setSource(null);
    setStatus("loading");

    const lifecycle: PanelSessionLifecycle = {
      bridge: null,
      closed: false,
      disposed: false,
      expiryTimer: undefined,
      loadCount: 0,
      sessionId: null,
      close(next, reason) {
        if (lifecycle.closed) return;
        lifecycle.closed = true;
        if (lifecycle.expiryTimer !== undefined) {
          window.clearTimeout(lifecycle.expiryTimer);
          lifecycle.expiryTimer = undefined;
        }
        const bridge = lifecycle.bridge;
        lifecycle.bridge = null;
        bridge?.close(reason);
        const sessionId = lifecycle.sessionId;
        lifecycle.sessionId = null;
        if (sessionId) {
          void window.translunar.revokePluginPanelSession(sessionId);
        }
        if (!lifecycle.disposed && lifecycleRef.current === lifecycle) {
          setStatus(next);
        }
      },
    };
    lifecycleRef.current = lifecycle;

    void window.translunar
      .issuePluginPanelSession({ pluginId, contributionId, revision })
      .then((session) => {
        if (lifecycle.closed || lifecycleRef.current !== lifecycle) {
          void window.translunar.revokePluginPanelSession(session.sessionId);
          return;
        }
        lifecycle.sessionId = session.sessionId;
        lifecycle.expiryTimer = window.setTimeout(
          () => lifecycle.close("revoked", "session_revoked"),
          Math.max(0, session.expiresAtMs - Date.now()),
        );
        setSource(session.url);
      })
      .catch(() => {
        if (!lifecycle.closed && lifecycleRef.current === lifecycle) {
          lifecycle.closed = true;
          setStatus("error");
        }
      });

    const stopRevocationListener = window.translunar.onPluginPanelRevoked(
      (revokedPluginId) => {
        if (revokedPluginId === null || revokedPluginId === pluginId) {
          lifecycle.close("revoked", "session_revoked");
        }
      },
    );

    return () => {
      lifecycle.disposed = true;
      stopRevocationListener();
      lifecycle.close("revoked", "host_closed");
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
    };
  }, [contributionId, pluginId, revision, projectId, segmentId, versionId]);

  const handleLoad = () => {
    const frameWindow = iframeRef.current?.contentWindow;
    const lifecycle = lifecycleRef.current;
    if (
      !frameWindow ||
      !lifecycle ||
      lifecycle.closed ||
      !lifecycle.sessionId
    ) {
      return;
    }
    lifecycle.loadCount += 1;
    if (lifecycle.loadCount > 1) {
      lifecycle.close("revoked", "navigation");
      return;
    }

    setStatus("connecting");
    const channel = new MessageChannel();
    const nonce = createNonce();
    const bridge = createPanelBridge({
      port: channel.port1,
      nonce,
      context: { pluginId, contributionId, revision },
      result: { pluginName, contributionName, revision },
      allowedMethods,
      owner: {
        pluginId,
        versionId,
        activationRevision: revision,
        contributionId,
      },
      ...(projectId ? { projectId } : {}),
      ...(segmentId ? { segmentId } : {}),
      onReady: () => {
        if (!lifecycle.closed && lifecycleRef.current === lifecycle) {
          setStatus("ready");
        }
      },
      onClosed: (reason) => lifecycle.close("error", reason),
    });
    lifecycle.bridge = bridge;
    try {
      frameWindow.postMessage(
        {
          version: BRIDGE_VERSION,
          type: "translunar.plugin.initialize",
          nonce,
        },
        "*",
        [channel.port2],
      );
    } catch {
      bridge.close("protocol_error");
    }
  };

  return (
    <section className="plugin-panel-host" aria-label={contributionName}>
      <header className="plugin-panel-host__header">
        <div>
          <strong>{contributionName}</strong>
          <span data-state={status}>{t(PANEL_STATUS_KEYS[status])}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={t("common.close")}>
          {t("common.close")}
        </button>
      </header>
      {status === "error" || status === "revoked" ? (
        <p role="alert">
          {status === "revoked"
            ? t("plugins.panel.sessionEnded")
            : t("plugins.panel.connectionFailed")}
        </p>
      ) : source ? (
        <iframe
          ref={iframeRef}
          title={contributionName}
          src={source}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={handleLoad}
        />
      ) : (
        <p role="status">{t("plugins.panel.loading")}</p>
      )}
    </section>
  );
}

export function createPanelBridge({
  port,
  nonce,
  context,
  result,
  owner,
  allowedMethods = ["panel.context"],
  projectId,
  segmentId,
  resolveForTest,
  onReady,
  onClosed,
  scheduleTimeout = (callback, delay) => window.setTimeout(callback, delay),
  clearScheduledTimeout = (timer) => window.clearTimeout(timer),
  queueTask = (callback) => queueMicrotask(callback),
}: PanelBridgeOptions): PanelBridge {
  const seenIds = new Set<string>();
  const pending = new Map<string, number>();
  const methods = new Set(allowedMethods);
  let state: "awaitingReady" | "ready" | "closed" = "awaitingReady";
  let handshakeTimer: number | undefined;

  const close = (reason: BridgeCloseReason) => {
    if (state === "closed") return;
    state = "closed";
    if (handshakeTimer !== undefined) {
      clearScheduledTimeout(handshakeTimer);
      handshakeTimer = undefined;
    }
    for (const timer of pending.values()) clearScheduledTimeout(timer);
    pending.clear();
    try {
      port.postMessage({
        version: BRIDGE_VERSION,
        type: "revoked",
        reason,
      });
    } catch {
      // A disconnected port is already revoked.
    }
    port.onmessage = null;
    port.close();
    onClosed(reason);
  };

  const post = (message: unknown): boolean => {
    try {
      port.postMessage(message);
      return true;
    } catch {
      close("protocol_error");
      return false;
    }
  };

  handshakeTimer = scheduleTimeout(
    () => close("protocol_error"),
    BRIDGE_TIMEOUT_MS,
  );
  port.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (state === "closed") return;
    const message = parsePanelMessage(data);
    if (!message) {
      close("protocol_error");
      return;
    }
    if (state === "awaitingReady") {
      if (message.type !== "ready" || message.nonce !== nonce) {
        close("protocol_error");
        return;
      }
      state = "ready";
      if (handshakeTimer !== undefined) {
        clearScheduledTimeout(handshakeTimer);
        handshakeTimer = undefined;
      }
      if (
        post({
          version: BRIDGE_VERSION,
          type: "context",
          context,
        })
      ) {
        onReady();
      }
      return;
    }
    if (message.type === "ready") {
      close("protocol_error");
      return;
    }
    if (message.type === "cancel") {
      const timer = pending.get(message.id);
      if (timer === undefined) {
        close("protocol_error");
        return;
      }
      clearScheduledTimeout(timer);
      pending.delete(message.id);
      return;
    }
    if (seenIds.has(message.id) || pending.size >= MAX_PENDING_REQUESTS) {
      close("protocol_error");
      return;
    }
    seenIds.add(message.id);
    const timer = scheduleTimeout(() => {
      pending.delete(message.id);
      post({
        version: BRIDGE_VERSION,
        type: "error",
        id: message.id,
        error: {
          code: "sandbox_timeout",
          message: "Panel request timed out.",
          retryable: true,
        },
      });
      close("request_timeout");
    }, BRIDGE_TIMEOUT_MS);
    pending.set(message.id, timer);
    queueTask(() => {
      const activeTimer = pending.get(message.id);
      if (activeTimer === undefined || state !== "ready") return;
      if (!methods.has(message.method)) {
        clearScheduledTimeout(activeTimer);
        pending.delete(message.id);
        post({
          version: BRIDGE_VERSION,
          type: "error",
          id: message.id,
          error: {
            code: "permission_denied",
            message:
              "Panel bridge method is not authorized for this contribution.",
            retryable: false,
          },
        });
        return;
      }
      void resolvePanelBridgeResult(
        message.method,
        message.params,
        result,
        owner,
        projectId,
        segmentId,
        resolveForTest,
      ).then((methodResult) => {
        const settledTimer = pending.get(message.id);
        if (settledTimer === undefined || state !== "ready") return;
        clearScheduledTimeout(settledTimer);
        pending.delete(message.id);
        if (methodResult.ok) {
          post({
            version: BRIDGE_VERSION,
            type: "result",
            id: message.id,
            result: methodResult.value,
          });
        } else {
          post({
            version: BRIDGE_VERSION,
            type: "error",
            id: message.id,
            error: methodResult.error,
          });
        }
      });
    });
  };
  port.start();

  return { close, isClosed: () => state === "closed" };
}

async function resolvePanelBridgeResult(
  method: PanelBridgeMethod,
  params: Record<string, unknown>,
  result: PanelBridgeOptions["result"],
  owner: PanelBridgeOptions["owner"],
  projectId: string | undefined,
  segmentId: string | undefined,
  resolveForTest: PanelBridgeOptions["resolveForTest"],
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | {
      ok: false;
      error: { code: string; message: string; retryable: boolean };
    }
> {
  // Production path: Engine-owned RPC only. Never trust renderer locale/selection
  // payloads — pass only identifiers allowed for the closed method shape.
  // panel.context must stay empty: Engine rejects unknown fields on that method.
  if (typeof window !== "undefined" && window.translunar?.invoke) {
    try {
      const hostParams = hostParamsForBridgeMethod(
        method,
        params,
        projectId,
        segmentId,
      );
      const response = await window.translunar.invoke(
        "plugin.uiPanel.bridge.call",
        {
          owner: {
            pluginId: owner.pluginId,
            versionId: owner.versionId,
            activationRevision: owner.activationRevision,
            contributionId: owner.contributionId,
          },
          method,
          params: hostParams,
        },
      );
      // Host-owned display labels win over Engine contribution aliases so the
      // public panel script can show plugin vs contribution names distinctly.
      const value = response.result as Record<string, unknown>;
      if (method === "panel.context") {
        return {
          ok: true,
          value: {
            ...value,
            pluginName: result.pluginName,
            contributionName: result.contributionName,
            revision: result.revision,
          },
        };
      }
      return { ok: true, value };
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: "permission_denied",
          message:
            cause instanceof Error
              ? cause.message
              : "Panel bridge authorization failed.",
          retryable: false,
        },
      };
    }
  }
  // Unit tests may inject a resolver; production never reaches here with translunar.
  if (resolveForTest) {
    try {
      return { ok: true, value: await resolveForTest(method, params) };
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: "permission_denied",
          message:
            cause instanceof Error
              ? cause.message
              : "Bridge test resolver failed.",
          retryable: false,
        },
      };
    }
  }
  return {
    ok: false,
    error: {
      code: "host_failed",
      message: "Panel bridge requires Engine authorization.",
      retryable: false,
    },
  };
}

const PANEL_STATUS_KEYS: Record<PanelStatus, MessageKey> = {
  loading: "plugins.panel.loading",
  connecting: "plugins.panel.connecting",
  ready: "plugins.panel.ready",
  error: "plugins.panel.error",
  revoked: "plugins.panel.revoked",
};

export function parsePanelMessage(value: unknown): PanelMessage | null {
  if (!isBoundedJson(value)) return null;
  try {
    if (!value || Array.isArray(value) || typeof value !== "object")
      return null;
    const message = value as Record<string, unknown>;
    if (message.version !== BRIDGE_VERSION) return null;
    if (
      message.type === "ready" &&
      Object.keys(message).length === 3 &&
      isText(message.nonce, 128)
    ) {
      return { version: 1, type: "ready", nonce: message.nonce };
    }
    if (
      message.type === "cancel" &&
      Object.keys(message).length === 3 &&
      isId(message.id)
    ) {
      return { version: 1, type: "cancel", id: message.id };
    }
    if (
      message.type === "request" &&
      Object.keys(message).length === 5 &&
      isId(message.id) &&
      isPanelBridgeMethod(message.method) &&
      isPanelRequestParams(message.method, message.params)
    ) {
      return {
        version: 1,
        type: "request",
        id: message.id,
        method: message.method,
        params: message.params,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Build Engine bridge params for a closed method. Identifiers are optional on
 * the host props (workbench may have project/segment) but must only be
 * forwarded when the method's contract allows them.
 */
export function hostParamsForBridgeMethod(
  method: PanelBridgeMethod,
  params: Record<string, unknown>,
  projectId: string | undefined,
  segmentId: string | undefined,
): Record<string, unknown> {
  switch (method) {
    case "panel.context":
      return {};
    case "panel.projectContext": {
      const hostParams: Record<string, unknown> = {};
      if (projectId) hostParams.projectId = projectId;
      return hostParams;
    }
    case "panel.activeSelection": {
      const hostParams: Record<string, unknown> = {};
      if (projectId) hostParams.projectId = projectId;
      if (segmentId) hostParams.segmentId = segmentId;
      return hostParams;
    }
    case "panel.proposeReplacement": {
      const hostParams: Record<string, unknown> = {};
      if (projectId) hostParams.projectId = projectId;
      if (segmentId) hostParams.segmentId = segmentId;
      if (typeof params.text === "string") hostParams.text = params.text;
      return hostParams;
    }
  }
}

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,96}$/u.test(value);
}

function isText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= max &&
    !hasControlCharacters(value)
  );
}

function isPanelBridgeMethod(value: unknown): value is PanelBridgeMethod {
  return (
    value === "panel.context" ||
    value === "panel.activeSelection" ||
    value === "panel.projectContext" ||
    value === "panel.proposeReplacement"
  );
}

function isPanelRequestParams(
  method: PanelBridgeMethod,
  value: unknown,
): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const params = value as Record<string, unknown>;
  if (method === "panel.proposeReplacement") {
    return (
      Reflect.ownKeys(params).length === 1 &&
      typeof params.text === "string" &&
      params.text.length >= 1 &&
      params.text.length <= 256 * 1024 &&
      !hasControlCharacters(params.text)
    );
  }
  return Reflect.ownKeys(params).length === 0;
}

function isBoundedJson(value: unknown): boolean {
  const seen = new Set<object>();
  let bytes = 0;
  let nodes = 0;

  const addBytes = (count: number): boolean => {
    if (!Number.isSafeInteger(count) || count < 0) return false;
    bytes += count;
    return bytes <= BRIDGE_MAX_BYTES;
  };

  const addString = (candidate: string, maxLength: number): boolean => {
    if (candidate.length > maxLength || !addBytes(2)) return false;
    for (let index = 0; index < candidate.length; index += 1) {
      const code = candidate.charCodeAt(index);
      if (code === 0x22 || code === 0x5c) {
        if (!addBytes(2)) return false;
      } else if (code <= 0x1f) {
        const shortEscape =
          code === 0x08 ||
          code === 0x09 ||
          code === 0x0a ||
          code === 0x0c ||
          code === 0x0d;
        if (!addBytes(shortEscape ? 2 : 6)) return false;
      } else if (code <= 0x7f) {
        if (!addBytes(1)) return false;
      } else if (code <= 0x7ff) {
        if (!addBytes(2)) return false;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const next = candidate.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          if (!addBytes(4)) return false;
          index += 1;
        } else if (!addBytes(6)) {
          return false;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        if (!addBytes(6)) return false;
      } else if (!addBytes(3)) {
        return false;
      }
    }
    return true;
  };

  const visit = (candidate: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > BRIDGE_MAX_NODES || depth > BRIDGE_MAX_DEPTH) return false;
    if (candidate === null) return addBytes(4);
    if (typeof candidate === "string") {
      return addString(candidate, BRIDGE_MAX_STRING_LENGTH);
    }
    if (typeof candidate === "boolean") return addBytes(candidate ? 4 : 5);
    if (typeof candidate === "number") {
      return Number.isFinite(candidate) && addBytes(String(candidate).length);
    }
    if (typeof candidate !== "object" || seen.has(candidate)) return false;

    seen.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        if (
          candidate.length > BRIDGE_MAX_ARRAY_ITEMS ||
          Object.getOwnPropertySymbols(candidate).length > 0
        ) {
          return false;
        }
        if (!addBytes(2)) return false;
        for (let index = 0; index < candidate.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(
            candidate,
            String(index),
          );
          if (!descriptor || !("value" in descriptor)) return false;
          if (index > 0 && !addBytes(1)) return false;
          if (!visit(descriptor.value, depth + 1)) return false;
        }
        return true;
      }

      if (
        Object.getPrototypeOf(candidate) !== Object.prototype ||
        Object.getOwnPropertySymbols(candidate).length > 0
      ) {
        return false;
      }
      if (!addBytes(2)) return false;
      let entryCount = 0;
      for (const key in candidate) {
        if (!Object.hasOwn(candidate, key)) continue;
        entryCount += 1;
        if (entryCount > BRIDGE_MAX_OBJECT_ENTRIES) return false;
        if (
          !key ||
          key.length > BRIDGE_MAX_KEY_LENGTH ||
          hasControlCharacters(key)
        ) {
          return false;
        }
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) return false;
        if (entryCount > 1 && !addBytes(1)) return false;
        if (
          !addString(key, BRIDGE_MAX_KEY_LENGTH) ||
          !addBytes(1) ||
          !visit(descriptor.value, depth + 1)
        ) {
          return false;
        }
      }
      return true;
    } finally {
      seen.delete(candidate);
    }
  };

  try {
    return visit(value, 0);
  } catch {
    return false;
  }
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}
