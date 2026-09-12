import {
  ProviderInstanceId,
  ThreadId,
  type AgentBrowserExecutionResult,
  type EmbeddedBrowserSnapshot,
} from "@cafecode/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { request as httpRequest } from "node:http";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentBrowserBridge, withAgentBrowserAuthorization } from "./AgentBrowserBridge.ts";

const threadId = ThreadId.make("thread-browser");
const providerInstanceId = ProviderInstanceId.make("codex");
const identity = { threadId, providerInstanceId };
const context = { tabId: "tab-1", origin: "https://example.test" };

const snapshot: EmbeddedBrowserSnapshot = {
  snapshotId: "snapshot-1",
  mode: "dom-accessibility",
  displayUrl: "https://example.test/",
  title: "Example",
  capturedAt: new Date().toISOString(),
  text: "Search",
  targets: [
    { targetId: "e1", role: "textbox", name: "Search", text: "", sensitive: false },
    { targetId: "e2", role: "textbox", name: "Password", text: "", sensitive: true },
    {
      targetId: "e3",
      role: "checkbox",
      name: "I am not a robot CAPTCHA",
      text: "",
      sensitive: false,
    },
  ],
  imageRegions: [],
  ocr: null,
  redactionNotice: "Form values omitted.",
};

const ocrSnapshot: EmbeddedBrowserSnapshot = {
  ...snapshot,
  snapshotId: "snapshot-ocr-1",
  mode: "ocr",
  ocr: {
    status: "completed",
    engine: "tesseract.js@7.0.0",
    language: "jpn",
    confidence: 88.4,
    truncated: false,
    text: "表示された文字",
  },
};

describe("AgentBrowserBridge", () => {
  let bridge: AgentBrowserBridge | undefined;

  it("replaces Windows environment aliases without mutating sibling environments", () => {
    const inherited = { cafe_code_agent_browser_mcp_authorization: "old", KEEP: "unchanged" };
    const config = {
      ...identity,
      url: "http://127.0.0.1:1/mcp",
      authorization: "Bearer replacement",
    };
    expect(withAgentBrowserAuthorization(inherited, config, "win32")).toEqual({
      KEEP: "unchanged",
      CAFE_CODE_AGENT_BROWSER_MCP_AUTHORIZATION: config.authorization,
    });
    expect(inherited.cafe_code_agent_browser_mcp_authorization).toBe("old");
    expect(withAgentBrowserAuthorization(inherited, undefined, "win32")).toBe(inherited);
    expect(
      withAgentBrowserAuthorization(inherited, config, "linux")
        .cafe_code_agent_browser_mcp_authorization,
    ).toBe("old");
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await bridge?.close();
  });

  it("rotates a replacement session and ignores its predecessor's delayed cleanup", async () => {
    bridge = new AgentBrowserBridge();
    const old = await bridge.mcpConfig(identity);
    bridge.poll({ ...context, defaultAccess: true });
    const pending = bridge.enqueue(identity, { type: "snapshot" });
    const rejected = expect(pending).rejects.toThrow("ended");
    const replacement = await bridge.mcpConfig(identity);
    await rejected;
    expect(replacement.authorization).not.toBe(old.authorization);
    bridge.releaseMcpConfig(old);
    const headers = {
      Authorization: old.authorization,
      "X-Cafe-Browser-Thread": threadId,
      "X-Cafe-Browser-Provider": providerInstanceId,
      "Content-Type": "application/json",
    };
    expect((await fetch(old.url, { method: "POST", headers, body: "{}" })).status).toBe(401);
    const next = bridge.enqueue(identity, { type: "snapshot" });
    const request = bridge.poll({ ...context, defaultAccess: true }).request!;
    expect(
      bridge.complete({
        context,
        requestId: request.requestId,
        result: { type: "snapshot", snapshot },
      }).accepted,
    ).toBe(true);
    await expect(next).resolves.toEqual({ type: "snapshot", snapshot });
  });

  it("expires a disconnected renderer's in-flight request without another enqueue", async () => {
    bridge = new AgentBrowserBridge();
    await bridge.mcpConfig(identity);
    vi.useFakeTimers();
    bridge.poll({ ...context, defaultAccess: true });
    const pending = bridge.enqueue(identity, { type: "snapshot" });
    const request = bridge.poll(context).request!;
    const rejected = expect(pending).rejects.toThrow("disconnected");
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(
      bridge.complete({
        context,
        requestId: request.requestId,
        result: { type: "snapshot", snapshot },
      }).accepted,
    ).toBe(false);
  });

  it("rejects browser-origin and oversized HTTP requests before creating an action", async () => {
    bridge = new AgentBrowserBridge();
    const config = await bridge.mcpConfig(identity);
    const headers = {
      Authorization: config.authorization,
      "X-Cafe-Browser-Thread": threadId,
      "X-Cafe-Browser-Provider": providerInstanceId,
      "Content-Type": "application/json",
    };
    const browser = await fetch(config.url, {
      method: "POST",
      headers: { ...headers, Origin: context.origin },
      body: "{}",
    });
    expect(browser.status).toBe(403);
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        config.url,
        { method: "POST", headers: { ...headers, Host: "127.0.0.1:1", "Content-Length": "2" } },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        },
      );
      request.setTimeout(2_000, () => request.destroy(new Error("Synthetic request timed out.")));
      request.once("error", reject);
      request.end("{}");
    });
    expect(wrongHost).toBe(403);
    const oversized = await fetch(config.url, {
      method: "POST",
      headers,
      body: "x".repeat(65_537),
    });
    expect(oversized.status).toBe(413);
    expect(bridge.poll(context).request).toBeNull();
  });

  it("uses the same identity-bound broker over the Claude SDK in-process transport", async () => {
    bridge = new AgentBrowserBridge();
    const config = await bridge.mcpConfig(identity);
    const server = bridge.sdkServer(config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "synthetic-claude-sdk", version: "1" });
    await client.connect(clientTransport);
    try {
      bridge.poll({ ...context, defaultAccess: true });
      const call = client.callTool({ name: "cafe_browser_snapshot", arguments: {} });
      let request: ReturnType<AgentBrowserBridge["poll"]>["request"] = null;
      await vi.waitFor(() => {
        request = bridge!.poll(context).request;
        expect(request).not.toBeNull();
      });
      bridge.complete({
        context,
        requestId: request!.requestId,
        result: { type: "snapshot", snapshot },
      });
      expect((await call).isError).not.toBe(true);
      bridge.releaseMcpConfig(config);
      expect(
        (await client.callTool({ name: "cafe_browser_snapshot", arguments: {} })).isError,
      ).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("closes a listener even when shutdown races its initial start", async () => {
    bridge = new AgentBrowserBridge();
    const started = bridge.start();
    await bridge.close();
    await started;
    await expect(bridge.mcpConfig(identity)).rejects.toThrow("closed");
  });

  it("bounds pending actions and cancels every queued action on revocation", async () => {
    bridge = new AgentBrowserBridge();
    await bridge.mcpConfig(identity);
    bridge.poll({ ...context, defaultAccess: true });
    const pending = Array.from({ length: 4 }, () =>
      bridge!.enqueue(identity, { type: "snapshot" }).catch((error) => error),
    );
    await expect(bridge.enqueue(identity, { type: "snapshot" })).rejects.toThrow("queue is full");
    bridge.revoke({ reason: "operator" });
    for (const result of await Promise.all(pending)) expect(result).toBeInstanceOf(Error);
    expect(bridge.poll(context).request).toBeNull();
  });

  it("allows live threads by default and isolates snapshot targets and opt-outs", async () => {
    bridge = new AgentBrowserBridge();
    const other = { ...identity, threadId: ThreadId.make("other-thread") };
    await bridge.mcpConfig(identity);
    await bridge.mcpConfig(other);
    const automatic = { ...context, defaultAccess: true };
    bridge.poll(automatic);

    const first = bridge.enqueue(identity, { type: "snapshot" });
    const second = bridge.enqueue(other, { type: "snapshot" });
    const firstPoll = bridge.poll(automatic);
    const request = firstPoll.request!;
    expect(request.threadId).toBe(identity.threadId);
    expect(firstPoll.grant).toMatchObject({ ...identity, grantId: request.grantId });
    bridge.complete({
      context,
      requestId: request.requestId,
      result: { type: "snapshot", snapshot },
    });
    await expect(first).resolves.toMatchObject({ type: "snapshot" });
    await expect(
      bridge.enqueue(other, {
        type: "click",
        snapshotId: snapshot.snapshotId,
        targetId: "e1",
      }),
    ).rejects.toThrow("Take a new snapshot in this thread");
    const otherRequest = bridge.poll(automatic).request!;
    expect(otherRequest.threadId).toBe(other.threadId);
    bridge.complete({
      context,
      requestId: otherRequest.requestId,
      result: { type: "snapshot", snapshot },
    });
    await expect(second).resolves.toMatchObject({ type: "snapshot" });
    expect(bridge.poll(automatic).grant.status).toBe("inactive");

    const pending = bridge.enqueue(identity, { type: "snapshot" });
    const rejected = expect(pending).rejects.toThrow("access ended");
    bridge.poll({ ...automatic, disabledThreadIds: [identity.threadId] });
    await rejected;
    await expect(bridge.enqueue(identity, { type: "snapshot" })).rejects.toThrow(
      "disabled for this thread",
    );
    const allowed = bridge.enqueue(other, { type: "snapshot" });
    const allowedRequest = bridge.poll({
      ...automatic,
      disabledThreadIds: [identity.threadId],
    }).request!;
    bridge.complete({
      context,
      requestId: allowedRequest.requestId,
      result: { type: "snapshot", snapshot },
    });
    await allowed;

    bridge.poll(automatic);
    const enabledAgain = bridge.enqueue(identity, { type: "snapshot" });
    const enabledRequest = bridge.poll(automatic).request!;
    bridge.complete({
      context,
      requestId: enabledRequest.requestId,
      result: { type: "snapshot", snapshot },
    });
    await enabledAgain;
  });

  it("ends default access when the browser disconnects or its provider is revoked", async () => {
    bridge = new AgentBrowserBridge();
    await bridge.mcpConfig(identity);
    bridge.poll({ ...context, defaultAccess: true });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5_001);
    await expect(bridge.enqueue(identity, { type: "snapshot" })).rejects.toThrow("disconnected");
    vi.restoreAllMocks();
    bridge.poll({ ...context, defaultAccess: true });
    bridge.revokeForIdentity(identity, "Session closed.");
    await expect(bridge.enqueue(identity, { type: "snapshot" })).rejects.toThrow(
      "not a live provider session",
    );
    bridge.revoke({ reason: "tab-closed" });
    await expect(bridge.enqueue(identity, { type: "snapshot" })).rejects.toThrow(
      "Open Agent Browser",
    );
  });

  it("retires old provider identities even when a thread switches before sharing a page", async () => {
    bridge = new AgentBrowserBridge();
    const replacement = { ...identity, providerInstanceId: ProviderInstanceId.make("claudeAgent") };
    const retired = await bridge.mcpConfig(identity);
    await bridge.mcpConfig(replacement);
    bridge.revokeWhenThreadProviderChanges(threadId, replacement.providerInstanceId);
    bridge.poll({ ...context, defaultAccess: true });

    await expect(bridge.enqueue(identity, { type: "snapshot" })).rejects.toThrow(
      "not a live provider session",
    );
    const response = await fetch(retired.url, {
      method: "POST",
      headers: {
        Authorization: retired.authorization,
        "Content-Type": "application/json",
        "X-Cafe-Browser-Thread": threadId,
        "X-Cafe-Browser-Provider": providerInstanceId,
      },
      body: "{}",
    });
    expect(response.status).toBe(401);
  });

  it("keeps other threads queued when the last requester changes provider", async () => {
    bridge = new AgentBrowserBridge();
    const other = { ...identity, threadId: ThreadId.make("other-thread") };
    const replacement = ProviderInstanceId.make("claudeAgent");
    await bridge.mcpConfig(identity);
    await bridge.mcpConfig(other);
    const automatic = { ...context, defaultAccess: true };
    bridge.poll(automatic);
    const otherResult = bridge.enqueue(other, { type: "snapshot" });
    const retiredResult = bridge.enqueue(identity, { type: "snapshot" });
    const rejected = expect(retiredResult).rejects.toThrow("access ended");
    bridge.revokeWhenThreadProviderChanges(threadId, replacement);
    await rejected;

    const next = bridge.poll(automatic).request!;
    expect(next.threadId).toBe(other.threadId);
    bridge.complete({
      context,
      requestId: next.requestId,
      result: { type: "snapshot", snapshot },
    });
    await expect(otherResult).resolves.toMatchObject({ type: "snapshot" });
    await expect(bridge.enqueue(identity, { type: "snapshot" })).rejects.toThrow(
      "not a live provider session",
    );
  });

  it("discards provider-owned targets before a replacement session can use them", async () => {
    bridge = new AgentBrowserBridge();
    await bridge.mcpConfig(identity);
    const automatic = { ...context, defaultAccess: true };
    bridge.poll(automatic);
    const pending = bridge.enqueue(identity, { type: "snapshot" });
    const request = bridge.poll(automatic).request!;
    bridge.complete({
      context,
      requestId: request.requestId,
      result: { type: "snapshot", snapshot },
    });
    await pending;

    bridge.revokeForProviderInstance(providerInstanceId, "Provider restarted.");
    await bridge.mcpConfig(identity);
    await expect(
      bridge.enqueue(identity, {
        type: "click",
        snapshotId: snapshot.snapshotId,
        targetId: "e1",
      }),
    ).rejects.toThrow("missing or stale");
  });

  it("binds one grant to an exact provider, thread, tab, and origin", async () => {
    bridge = new AgentBrowserBridge();
    expect(
      bridge.grant({
        ...identity,
        ...context,
        origin: "https://example.test/path",
        durationSeconds: 60,
      }),
    ).toMatchObject({ status: "inactive" });
    const grant = bridge.grant({
      ...identity,
      ...context,
      durationSeconds: 60,
    });
    expect(grant).toMatchObject({ status: "active", ...identity, ...context });

    await expect(
      bridge.enqueue(
        { threadId, providerInstanceId: ProviderInstanceId.make("claudeAgent") },
        { type: "snapshot" },
      ),
    ).rejects.toThrow("different thread or provider");

    const poll = bridge.poll({ ...context, origin: "https://other.test" });
    expect(poll.grant.status).toBe("inactive");
    await expect(bridge.enqueue(identity, { type: "snapshot" })).rejects.toThrow(
      "Thread access is on by default",
    );
  });

  it("accepts only renderer-correlated completions and rejects sensitive typing", async () => {
    bridge = new AgentBrowserBridge();
    bridge.grant({ ...identity, ...context, durationSeconds: 60 });

    const snapshotResult = bridge.enqueue(identity, { type: "snapshot" });
    const request = bridge.poll(context).request;
    expect(request?.action.type).toBe("snapshot");
    bridge.complete({
      context,
      requestId: request!.requestId,
      result: { type: "snapshot", snapshot },
    });
    await expect(snapshotResult).resolves.toMatchObject({ type: "snapshot" });

    await expect(
      bridge.enqueue(identity, {
        type: "type",
        snapshotId: snapshot.snapshotId,
        targetId: "e2",
        value: "ordinary words",
      }),
    ).rejects.toThrow("operator-only");
    await expect(
      bridge.enqueue(identity, {
        type: "type",
        snapshotId: snapshot.snapshotId,
        targetId: "e1",
        value: "123456",
      }),
    ).rejects.toThrow("Sensitive-looking");
    await expect(
      bridge.enqueue(identity, {
        type: "click",
        snapshotId: snapshot.snapshotId,
        targetId: "e2",
      }),
    ).rejects.toThrow("Sensitive controls");
    await expect(
      bridge.enqueue(identity, {
        type: "click",
        snapshotId: snapshot.snapshotId,
        targetId: "e3",
      }),
    ).rejects.toThrow("CAPTCHA");
  });

  it("rejects the final action result when its tab sharing or origin drifted", async () => {
    bridge = new AgentBrowserBridge();
    bridge.grant({ ...identity, ...context, durationSeconds: 60 });
    const action = bridge.enqueue(identity, { type: "history", action: "reload" });
    const request = bridge.poll(context).request;
    expect(request).not.toBeNull();

    expect(
      bridge.complete({
        context,
        requestId: request!.requestId,
        result: {
          type: "action",
          result: {
            status: "completed",
            message: "Reloading",
            state: {
              status: "open",
              tabId: context.tabId,
              displayUrl: "https://other.test/",
              title: "Other",
              loading: false,
              canGoBack: false,
              canGoForward: false,
              shared: false,
              sharedOrigin: null,
            },
          },
        },
      }),
    ).toMatchObject({ accepted: false, grant: { status: "inactive" } });
    await expect(action).rejects.toThrow("stale before completion");
  });

  it("binds provider OCR to the same grant and rejects a mismatched DOM completion", async () => {
    bridge = new AgentBrowserBridge();
    bridge.grant({ ...identity, ...context, durationSeconds: 60 });
    const pending = bridge.enqueue(identity, { type: "ocr", language: "jpn" });
    const request = bridge.poll(context).request;
    expect(request?.action).toEqual({ type: "ocr", language: "jpn" });

    expect(
      bridge.complete({
        context,
        requestId: request!.requestId,
        result: { type: "snapshot", snapshot },
      }),
    ).toMatchObject({ accepted: false, grant: { status: "inactive" } });
    await expect(pending).rejects.toThrow("stale before completion");

    bridge.grant({ ...identity, ...context, durationSeconds: 60 });
    const accepted = bridge.enqueue(identity, { type: "ocr", language: "jpn" });
    const acceptedRequest = bridge.poll(context).request;
    expect(
      bridge.complete({
        context,
        requestId: acceptedRequest!.requestId,
        result: { type: "snapshot", snapshot: ocrSnapshot },
      }).accepted,
    ).toBe(true);
    await expect(accepted).resolves.toEqual({ type: "snapshot", snapshot: ocrSnapshot });
  });

  it("rejects schemes, credentials, and cross-origin navigation under an existing grant", async () => {
    bridge = new AgentBrowserBridge();
    bridge.grant({ ...identity, ...context, durationSeconds: 60 });
    for (const url of [
      "file:///tmp/secret",
      "javascript:alert(1)",
      "data:text/plain,hello",
      "https://user:password@example.test/private",
      "http://127.0.0.1:3000/admin",
      "https://other.test/",
    ]) {
      await expect(bridge.enqueue(identity, { type: "navigate", url })).rejects.toThrow();
    }

    const sameOrigin = bridge.enqueue(identity, {
      type: "navigate",
      url: "https://example.test/next?public=1",
    });
    const request = bridge.poll(context).request;
    expect(request?.action).toMatchObject({ type: "navigate" });
    bridge.revoke({ reason: "operator" });
    await expect(sameOrigin).rejects.toThrow("revoked");
  });

  it("expires an idle grant and rejects pending work without relying on renderer polling", async () => {
    vi.useFakeTimers();
    bridge = new AgentBrowserBridge();
    bridge.grant({ ...identity, ...context, durationSeconds: 60 });
    const pending = bridge.enqueue(identity, { type: "snapshot" });
    const rejected = expect(pending).rejects.toThrow("grant expired");

    await vi.advanceTimersByTimeAsync(60_000);

    await rejected;
    expect(bridge.poll(context).grant).toMatchObject({ status: "inactive" });
  });

  it("exposes real authenticated MCP tools and waits for renderer execution", async () => {
    bridge = new AgentBrowserBridge();
    bridge.grant({ ...identity, ...context, durationSeconds: 60 });
    const config = await bridge.mcpConfig(identity);
    expect(config.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(config.authorization).toMatch(/^Bearer [A-Za-z0-9_-]{40,}$/);

    const forgedIdentity = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: config.authorization,
        "Content-Type": "application/json",
        "X-Cafe-Browser-Thread": "another-thread",
        "X-Cafe-Browser-Provider": providerInstanceId,
      },
      body: "{}",
    });
    expect(forgedIdentity.status).toBe(401);

    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        headers: {
          Authorization: config.authorization,
          "X-Cafe-Browser-Thread": threadId,
          "X-Cafe-Browser-Provider": providerInstanceId,
        },
      },
    });
    const client = new Client({ name: "agent-browser-test", version: "1.0.0" });
    await client.connect(transport as unknown as Transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "cafe_browser_snapshot",
        "cafe_browser_ocr",
        "cafe_browser_navigate",
        "cafe_browser_click",
        "cafe_browser_type",
        "cafe_browser_history",
      ]),
    );

    const call = client.callTool({ name: "cafe_browser_snapshot", arguments: {} });
    let request = bridge.poll(context).request;
    for (let attempt = 0; !request && attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      request = bridge.poll(context).request;
    }
    expect(request).not.toBeNull();
    const execution: AgentBrowserExecutionResult = { type: "snapshot", snapshot };
    expect(
      bridge.complete({ context, requestId: request!.requestId, result: execution }).accepted,
    ).toBe(true);
    const result = await call;
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: expect.stringContaining("snapshot-1") }),
      ]),
    );
    await client.close();
  });

  it("forgets a stopped provider identity's bearer before a later grant", async () => {
    bridge = new AgentBrowserBridge();
    const beforeStop = await bridge.mcpConfig(identity);
    bridge.revokeForIdentity(identity, "The provider session stopped.");
    const afterStop = await bridge.mcpConfig(identity);

    expect(afterStop.authorization).not.toBe(beforeStop.authorization);
  });
});
