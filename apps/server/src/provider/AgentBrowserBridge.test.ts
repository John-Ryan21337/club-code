import {
  ProviderInstanceId,
  ThreadId,
  type AgentBrowserExecutionResult,
  type EmbeddedBrowserSnapshot,
} from "@cafecode/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentBrowserBridge } from "./AgentBrowserBridge.ts";

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

  afterEach(async () => {
    vi.useRealTimers();
    await bridge?.close();
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
      "No live browser grant",
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
        "club_browser_snapshot",
        "club_browser_ocr",
        "club_browser_navigate",
        "club_browser_click",
        "club_browser_type",
        "club_browser_history",
      ]),
    );

    const call = client.callTool({ name: "club_browser_snapshot", arguments: {} });
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
