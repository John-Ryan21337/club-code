import {
  AGENT_BROWSER_MAX_QUEUED_REQUESTS,
  AGENT_BROWSER_MAX_REQUESTS_PER_GRANT,
  AGENT_BROWSER_REQUEST_TIMEOUT_MS,
  type AgentBrowserAction,
  type AgentBrowserCompleteInput,
  type AgentBrowserCompleteResult,
  type AgentBrowserExecutionResult,
  type AgentBrowserGrantInput,
  type AgentBrowserGrantState,
  type AgentBrowserPollResult,
  type AgentBrowserRequest,
  type AgentBrowserRevokeInput,
  type AgentBrowserSessionContext,
  type EmbeddedBrowserSnapshot,
  type ProviderInstanceId,
  type ThreadId,
} from "@cafecode/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";

interface AgentIdentity {
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
}

const identityKey = (identity: AgentIdentity): string =>
  `${identity.threadId}\u0000${identity.providerInstanceId}`;

const isSameIdentity = (left: AgentIdentity, right: AgentIdentity): boolean =>
  left.threadId === right.threadId && left.providerInstanceId === right.providerInstanceId;

interface ActiveGrant extends AgentBrowserGrantInput {
  readonly grantId: AgentBrowserRequest["grantId"];
  readonly grantedAt: string;
  readonly expiresAt: string;
  requestCount: number;
}

interface PendingRequest {
  readonly request: AgentBrowserRequest;
  readonly resolve: (result: AgentBrowserExecutionResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface AgentBrowserMcpConfig {
  readonly url: string;
  readonly authorization: string;
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
}

const inactive = (reason: string): AgentBrowserGrantState => ({
  status: "inactive",
  reason,
});

const safeEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const isLoopback = (address: string | undefined): boolean =>
  address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";

const looksSensitive = (value: string): boolean => {
  const normalized = value.trim();
  if (/^\d{4,8}$/.test(normalized)) return true;
  if (/^(?:sk|pk|api|key|token|secret|bearer)[-_]/i.test(normalized)) return true;
  if (/^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(normalized)) return true;
  if (/^[A-Za-z0-9+/=_-]{24,}$/.test(normalized) && /\d/.test(normalized)) return true;
  return false;
};

const isCaptchaTarget = (
  target: Pick<EmbeddedBrowserSnapshot["targets"][number], "role" | "name" | "text">,
): boolean =>
  /\b(?:captcha|recaptcha|hcaptcha|turnstile|i\s*am\s*not\s*(?:a\s*)?robot|robot\s*check|human\s*verification|security\s*challenge)\b/i.test(
    `${target.role} ${target.name} ${target.text}`,
  );

const snapshotMatchesOrigin = (
  snapshot: EmbeddedBrowserSnapshot,
  origin: string,
  mode: "dom-accessibility" | "ocr",
): boolean => {
  if (
    snapshot.mode !== mode ||
    (mode === "dom-accessibility" ? snapshot.ocr !== null : snapshot.ocr === null)
  ) {
    return false;
  }
  try {
    const url = new URL(snapshot.displayUrl);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.origin === origin
    );
  } catch {
    return false;
  }
};

const summarize = (action: AgentBrowserAction): string => {
  switch (action.type) {
    case "snapshot":
      return "Read a redacted DOM/accessibility snapshot";
    case "ocr":
      return `Run bounded offline ${action.language === "jpn" ? "Japanese" : "English"} OCR on the visible browser viewport`;
    case "navigate":
      return `Navigate to ${new URL(action.url).origin}`;
    case "click":
      return `Click target ${action.targetId} from snapshot ${action.snapshotId}`;
    case "type":
      return `Type ${action.value.length} non-sensitive character(s) into target ${action.targetId}`;
    case "history":
      return `Browser history action: ${action.action}`;
  }
};

/**
 * One process-local, single-grant request broker. It deliberately owns no
 * persistence adapter: grants, bearer credentials, queued values, and results
 * disappear with the provider process.
 */
export class AgentBrowserBridge {
  /**
   * Bearers are per provider identity, not bridge-wide. Every bearer remains
   * process-local, but a Codex/Claude process that knows its own bearer still
   * cannot select a different thread with forged identity headers.
   */
  readonly #credentialsByIdentity = new Map<string, string>();
  readonly #identitiesByCredential = new Map<string, AgentIdentity>();
  readonly #queue: PendingRequest[] = [];
  readonly #snapshots = new Map<string, EmbeddedBrowserSnapshot>();
  #active: ActiveGrant | undefined;
  #inFlight: PendingRequest | undefined;
  #grantTimer: ReturnType<typeof setTimeout> | undefined;
  #server: Server | undefined;
  #starting: Promise<void> | undefined;
  #url: string | undefined;

  async start(): Promise<void> {
    if (this.#server) return;
    if (!this.#starting) {
      this.#starting = (async () => {
        const server = createServer((request, response) => {
          void this.#handleHttp(request, response);
        });
        server.requestTimeout = AGENT_BROWSER_REQUEST_TIMEOUT_MS + 5_000;
        server.headersTimeout = 10_000;
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
          });
        });
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          throw new Error("Agent browser MCP listener did not expose a TCP address.");
        }
        this.#server = server;
        this.#url = `http://127.0.0.1:${address.port}/mcp`;
      })();
    }
    try {
      await this.#starting;
    } finally {
      this.#starting = undefined;
    }
  }

  async close(): Promise<void> {
    this.revoke({ reason: "operator" });
    const server = this.#server;
    this.#server = undefined;
    this.#url = undefined;
    this.#credentialsByIdentity.clear();
    this.#identitiesByCredential.clear();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  grant(input: AgentBrowserGrantInput): AgentBrowserGrantState {
    this.#expireIfNeeded();
    this.#revokeInternal("Replaced by a newer operator grant.");
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(input.origin);
    } catch {
      return inactive("The requested browser origin is invalid.");
    }
    if (
      (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:") ||
      parsedOrigin.username.length > 0 ||
      parsedOrigin.password.length > 0 ||
      parsedOrigin.origin !== input.origin
    ) {
      return inactive("The grant requires one canonical, credential-free HTTP(S) origin.");
    }
    const now = Date.now();
    this.#active = {
      ...input,
      grantId: randomUUID(),
      grantedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + input.durationSeconds * 1_000).toISOString(),
      requestCount: 0,
    };
    this.#grantTimer = setTimeout(() => {
      this.#revokeInternal("The operator grant expired.");
    }, input.durationSeconds * 1_000);
    return this.#state();
  }

  revoke(input: AgentBrowserRevokeInput): AgentBrowserGrantState {
    this.#revokeInternal(`Grant revoked: ${input.reason}.`);
    return inactive(`Grant revoked: ${input.reason}.`);
  }

  revokeForIdentity(identity: AgentIdentity, reason: string): void {
    const grant = this.#active;
    if (grant && isSameIdentity(grant, identity)) this.#revokeInternal(reason);
    this.#forgetIdentity(identity);
  }

  revokeForProviderInstance(providerInstanceId: ProviderInstanceId, reason: string): void {
    if (this.#active?.providerInstanceId === providerInstanceId) this.#revokeInternal(reason);
    for (const [credential, identity] of this.#identitiesByCredential) {
      if (identity.providerInstanceId === providerInstanceId) {
        this.#identitiesByCredential.delete(credential);
        this.#credentialsByIdentity.delete(identityKey(identity));
      }
    }
  }

  revokeWhenThreadProviderChanges(
    threadId: ThreadId,
    providerInstanceId: ProviderInstanceId,
  ): void {
    const grant = this.#active;
    if (grant && grant.threadId === threadId && grant.providerInstanceId !== providerInstanceId) {
      this.#revokeInternal("Grant revoked because the thread changed provider instance.");
      this.#forgetIdentity(grant);
    }
  }

  poll(context: AgentBrowserSessionContext): AgentBrowserPollResult {
    this.#expireIfNeeded();
    if (!this.#matchesContext(context)) {
      this.#revokeInternal("Grant revoked because the tab or origin changed.");
      return { grant: inactive("No grant for this tab and origin."), request: null };
    }
    if (!this.#inFlight) this.#inFlight = this.#queue.shift();
    return {
      grant: this.#state(),
      request: this.#inFlight?.request ?? null,
    };
  }

  complete(input: AgentBrowserCompleteInput): AgentBrowserCompleteResult {
    this.#expireIfNeeded();
    if (!this.#matchesContext(input.context)) {
      this.#revokeInternal("Grant revoked because the tab or origin changed.");
      return { accepted: false, grant: inactive("No grant for this tab and origin.") };
    }
    const pending = this.#inFlight;
    if (!pending || pending.request.requestId !== input.requestId) {
      return { accepted: false, grant: this.#state() };
    }
    if (
      pending.request.tabId !== input.context.tabId ||
      pending.request.origin !== input.context.origin ||
      !this.#completionMatchesRequest(pending.request, input.result, input.context.origin)
    ) {
      this.#rejectPending(pending, "The browser action became stale before completion.");
      this.#revokeInternal("Grant revoked because the completed action changed the tab or origin.");
      return {
        accepted: false,
        grant: inactive("The browser action became stale before completion."),
      };
    }
    clearTimeout(pending.timer);
    this.#inFlight = undefined;
    if (input.result.type === "snapshot" && input.result.snapshot) {
      this.#snapshots.clear();
      this.#snapshots.set(input.result.snapshot.snapshotId, input.result.snapshot);
    }
    pending.resolve(input.result);
    return { accepted: true, grant: this.#state() };
  }

  async mcpConfig(identity: AgentIdentity): Promise<AgentBrowserMcpConfig> {
    await this.start();
    const key = identityKey(identity);
    let authorization = this.#credentialsByIdentity.get(key);
    if (!authorization) {
      authorization = `Bearer ${randomBytes(32).toString("base64url")}`;
      this.#credentialsByIdentity.set(key, authorization);
      this.#identitiesByCredential.set(authorization, identity);
    }
    return {
      url: this.#url!,
      authorization,
      ...identity,
    };
  }

  async enqueue(
    identity: AgentIdentity,
    action: AgentBrowserAction,
  ): Promise<AgentBrowserExecutionResult> {
    this.#expireIfNeeded();
    const grant = this.#active;
    if (!grant)
      throw new Error("No live browser grant. Ask the operator to grant this thread access.");
    if (
      grant.threadId !== identity.threadId ||
      grant.providerInstanceId !== identity.providerInstanceId
    ) {
      throw new Error("The live browser grant belongs to a different thread or provider instance.");
    }
    if (grant.requestCount >= AGENT_BROWSER_MAX_REQUESTS_PER_GRANT) {
      this.#revokeInternal("The browser grant reached its request limit.");
      throw new Error("The browser grant reached its request limit.");
    }
    if (this.#queue.length + (this.#inFlight ? 1 : 0) >= AGENT_BROWSER_MAX_QUEUED_REQUESTS) {
      throw new Error(
        "The browser action queue is full. Wait for the operator to finish pending actions.",
      );
    }
    if (action.type === "click" || action.type === "type") {
      const target = this.#snapshots
        .get(action.snapshotId)
        ?.targets.find((candidate) => candidate.targetId === action.targetId);
      if (!target) {
        throw new Error("The control target is missing or stale. Take a new snapshot.");
      }
      if (isCaptchaTarget(target)) {
        throw new Error("CAPTCHA and human-verification controls are operator-only.");
      }
      if (action.type === "click" && target.sensitive) {
        throw new Error("Sensitive controls are operator-only.");
      }
    }
    if (action.type === "type") {
      if (looksSensitive(action.value)) {
        throw new Error(
          "Sensitive-looking values and one-time codes must be typed by the operator.",
        );
      }
      const target = this.#snapshots
        .get(action.snapshotId)
        ?.targets.find((candidate) => candidate.targetId === action.targetId);
      if (!target) throw new Error("The typing target is missing or stale. Take a new snapshot.");
      if (target.sensitive) {
        throw new Error(
          "This field is sensitive. Credentials and verification codes are operator-only.",
        );
      }
    }
    if (action.type === "navigate") {
      let target: URL;
      try {
        target = new URL(action.url);
      } catch {
        throw new Error("Navigation requires an absolute URL.");
      }
      if (
        (target.protocol !== "https:" && target.protocol !== "http:") ||
        target.username.length > 0 ||
        target.password.length > 0
      ) {
        throw new Error("Agent navigation allows only credential-free HTTP(S) URLs.");
      }
      if (target.origin !== grant.origin) {
        throw new Error(
          "Agent navigation cannot leave the exact granted origin. The operator must navigate and grant the new origin.",
        );
      }
    }

    const requestId = randomUUID();
    const createdAt = Date.now();
    const request: AgentBrowserRequest = {
      requestId,
      grantId: grant.grantId,
      threadId: grant.threadId,
      providerInstanceId: grant.providerInstanceId,
      tabId: grant.tabId,
      origin: grant.origin,
      action,
      summary: summarize(action),
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(
        Math.min(createdAt + AGENT_BROWSER_REQUEST_TIMEOUT_MS, Date.parse(grant.expiresAt)),
      ).toISOString(),
    };
    grant.requestCount += 1;
    return new Promise<AgentBrowserExecutionResult>((resolve, reject) => {
      const pending: PendingRequest = {
        request,
        resolve,
        reject,
        timer: setTimeout(
          () => {
            if (this.#inFlight === pending) this.#inFlight = undefined;
            const index = this.#queue.indexOf(pending);
            if (index >= 0) this.#queue.splice(index, 1);
            reject(new Error("The browser action timed out before the operator completed it."));
          },
          Math.max(1, Date.parse(request.expiresAt) - Date.now()),
        ),
      };
      this.#queue.push(pending);
    });
  }

  #state(): AgentBrowserGrantState {
    const grant = this.#active;
    if (!grant) return inactive("No active operator grant.");
    return {
      status: "active",
      grantId: grant.grantId,
      threadId: grant.threadId,
      providerInstanceId: grant.providerInstanceId,
      tabId: grant.tabId,
      origin: grant.origin,
      grantedAt: grant.grantedAt,
      expiresAt: grant.expiresAt,
      requestCount: grant.requestCount,
      requestLimit: AGENT_BROWSER_MAX_REQUESTS_PER_GRANT,
      pendingAction: this.#inFlight?.request.summary ?? this.#queue[0]?.request.summary ?? null,
    };
  }

  #matchesContext(context: AgentBrowserSessionContext): boolean {
    const grant = this.#active;
    return grant?.tabId === context.tabId && grant.origin === context.origin;
  }

  #completionMatchesRequest(
    request: AgentBrowserRequest,
    result: AgentBrowserExecutionResult,
    origin: string,
  ): boolean {
    if (result.type === "snapshot") {
      return (
        (request.action.type === "snapshot" || request.action.type === "ocr") &&
        result.snapshot !== null &&
        snapshotMatchesOrigin(
          result.snapshot,
          origin,
          request.action.type === "ocr" ? "ocr" : "dom-accessibility",
        )
      );
    }
    const state = result.result.state;
    return (
      request.action.type !== "snapshot" &&
      request.action.type !== "ocr" &&
      state.status === "open" &&
      state.tabId === request.tabId &&
      state.shared &&
      state.sharedOrigin === origin
    );
  }

  #rejectPending(pending: PendingRequest, reason: string): void {
    clearTimeout(pending.timer);
    if (this.#inFlight === pending) this.#inFlight = undefined;
    const index = this.#queue.indexOf(pending);
    if (index >= 0) this.#queue.splice(index, 1);
    pending.reject(new Error(reason));
  }

  #forgetIdentity(identity: AgentIdentity): void {
    const key = identityKey(identity);
    const credential = this.#credentialsByIdentity.get(key);
    if (credential) this.#identitiesByCredential.delete(credential);
    this.#credentialsByIdentity.delete(key);
  }

  #expireIfNeeded(): void {
    if (this.#active && Date.now() >= Date.parse(this.#active.expiresAt)) {
      this.#revokeInternal("The operator grant expired.");
    }
  }

  #revokeInternal(reason: string): void {
    if (this.#grantTimer) clearTimeout(this.#grantTimer);
    this.#grantTimer = undefined;
    this.#active = undefined;
    this.#snapshots.clear();
    const pending = [this.#inFlight, ...this.#queue].filter(
      (entry): entry is PendingRequest => entry !== undefined,
    );
    this.#inFlight = undefined;
    this.#queue.length = 0;
    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
  }

  async #handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const fail = (status: number, message: string): void => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32_000, message }, id: null }));
    };
    if (!isLoopback(request.socket.remoteAddress)) return fail(403, "Forbidden.");
    if (request.method !== "POST" || request.url !== "/mcp")
      return fail(405, "Method not allowed.");
    const host = request.headers.host;
    if (host !== "127.0.0.1" && !/^127\.0\.0\.1:\d{1,5}$/.test(host ?? "")) {
      return fail(403, "Forbidden.");
    }
    const authorization = request.headers.authorization;
    const authorizedIdentity = authorization
      ? [...this.#identitiesByCredential.entries()].find(([credential]) =>
          safeEqual(authorization, credential),
        )?.[1]
      : undefined;
    if (!authorizedIdentity) {
      return fail(401, "Unauthorized.");
    }
    const threadId = request.headers["x-cafe-browser-thread"];
    const providerInstanceId = request.headers["x-cafe-browser-provider"];
    if (
      typeof threadId !== "string" ||
      typeof providerInstanceId !== "string" ||
      !isSameIdentity(authorizedIdentity, {
        threadId: threadId as ThreadId,
        providerInstanceId: providerInstanceId as ProviderInstanceId,
      })
    ) {
      return fail(401, "Missing agent identity.");
    }
    if (request.headers["content-length"] === undefined) {
      return fail(411, "Content-Length is required.");
    }
    const contentLength = Number(request.headers["content-length"]);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > 65_536) {
      return fail(413, "Request too large.");
    }
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      return fail(415, "JSON content is required.");
    }

    const server = this.#makeMcpServer(authorizedIdentity);
    const transport = new StreamableHTTPServerTransport();
    response.once("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      // The SDK's Node transport declaration is structurally compatible at
      // runtime but currently conflicts with exactOptionalPropertyTypes.
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response);
    } catch {
      if (!response.headersSent) fail(500, "Agent browser request failed.");
    }
  }

  #makeMcpServer(identity: AgentIdentity): McpServer {
    const server = new McpServer({ name: "club-code-browser", version: "1.0.0" });
    const run = async (action: AgentBrowserAction) => {
      try {
        const result = await this.enqueue(identity, action);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Browser request failed.",
            },
          ],
        };
      }
    };
    const approval =
      "Requires a live operator grant and a visible native approval for this action.";
    server.registerTool(
      "club_browser_snapshot",
      {
        description: `Read the current page as bounded, redacted DOM/accessibility text. No screenshots or OCR. ${approval}`,
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => run({ type: "snapshot" }),
    );
    server.registerTool(
      "club_browser_ocr",
      {
        description:
          `Run bounded offline OCR on only the currently visible isolated-browser viewport. ` +
          `The image is transient and returned OCR text is separately labeled and redacted. ${approval}`,
        inputSchema: { language: z.enum(["eng", "jpn"]) },
        annotations: { readOnlyHint: true },
      },
      async ({ language }) => run({ type: "ocr", language }),
    );
    server.registerTool(
      "club_browser_navigate",
      {
        description: `Navigate the operator's isolated browser tab to an absolute URL. ${approval}`,
        inputSchema: { url: z.string().url().max(4_096) },
      },
      async ({ url }) => run({ type: "navigate", url }),
    );
    server.registerTool(
      "club_browser_click",
      {
        description: `Click a target from a recent redacted snapshot. ${approval}`,
        inputSchema: {
          snapshotId: z.string().min(1).max(128),
          targetId: z.string().regex(/^e[0-9]+$/),
        },
      },
      async ({ snapshotId, targetId }) => run({ type: "click", snapshotId, targetId }),
    );
    server.registerTool(
      "club_browser_type",
      {
        description:
          `Type only non-sensitive text into a non-sensitive target from a recent snapshot. ` +
          `Passwords, credentials, tokens, and verification codes are operator-only. ${approval}`,
        inputSchema: {
          snapshotId: z.string().min(1).max(128),
          targetId: z.string().regex(/^e[0-9]+$/),
          value: z.string().min(1).max(1_024),
        },
      },
      async ({ snapshotId, targetId, value }) => run({ type: "type", snapshotId, targetId, value }),
    );
    server.registerTool(
      "club_browser_history",
      {
        description: `Go back, forward, reload, or stop loading. ${approval}`,
        inputSchema: { action: z.enum(["back", "forward", "reload", "stop"]) },
      },
      async ({ action }) => run({ type: "history", action }),
    );
    return server;
  }
}

let singleton: AgentBrowserBridge | undefined;

export const getAgentBrowserBridge = (): AgentBrowserBridge => {
  singleton ??= new AgentBrowserBridge();
  return singleton;
};

/** Releases the listener and every process-local bearer during daemon shutdown. */
export const closeAgentBrowserBridge = async (): Promise<void> => {
  const bridge = singleton;
  singleton = undefined;
  await bridge?.close();
};
