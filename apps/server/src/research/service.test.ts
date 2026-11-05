import { describe, expect, it, vi } from "vitest";
import { ResearchService } from "./service.ts";
import type { ResearchAction } from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { ResearchAction as ActionSchema } from "@cafecode/contracts";

const id = "e1f83530-2d40-4bca-a315-74a94ab0b2ec";
const id2 = "e1f83530-2d40-4bca-a315-74a94ab0b2ed";
const key = "sk-test-only-never-a-real-api-key";
const prepare = {
  action: "prepare",
  id,
  scope: "thread",
  prompt: "Compare public battery research 日本語",
} as const;
const start = {
  action: "start",
  id,
  model: "o4-mini-deep-research",
  maxToolCalls: 10,
  scope: "Public evidence only",
  period: "2024–2026",
  format: "A cited comparison",
} as const;
const decode = Schema.decodeUnknownSync(ActionSchema);
function fixture() {
  const values = new Map<string, Uint8Array>();
  const storage = {
    get: async (name: string) => values.get(name) ?? null,
    set: vi.fn(async (name: string, value: Uint8Array) => {
      values.set(name, value);
    }),
    remove: async (name: string) => {
      values.delete(name);
    },
  };
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ id: "resp_test", status: "queued" })));
  const service = new ResearchService(storage, request);
  const ready = async () => {
    await service.execute({ action: "configure", key });
    await service.execute(prepare);
  };
  return { values, storage, request, service, ready };
}

describe("dedicated API research", () => {
  it("saves a clarification draft without spending credits and does not expose the key", async () => {
    const { service, request } = fixture();
    await service.execute({ action: "configure", key });
    const result = await service.execute(prepare);
    expect(result.jobs[0]).toMatchObject({ status: "draft", prompt: prepare.prompt });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(request).not.toHaveBeenCalled();
    expect((await service.execute({ action: "list", scope: "other" })).jobs).toEqual([]);
    expect((await service.execute({ action: "list", scope: "*" })).jobs).toHaveLength(1);
  });

  it("starts once, resumes after restart, and preserves the report, citations, and usage", async () => {
    const { service, storage, request, ready } = fixture();
    await ready();
    await Promise.all([service.execute(start), service.execute(start)]);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.redirect).toBe("error");
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      background: true,
      store: true,
      model: start.model,
      max_tool_calls: 10,
      tools: [{ type: "web_search_preview" }],
    });
    expect(body.input).toContain(start.scope);
    request.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "resp_test",
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "Findings — 日本語",
                  annotations: [
                    { type: "url_citation", title: "Study", url: "https://example.org/study" },
                    { type: "url_citation", title: "Bad", url: "javascript:alert(1)" },
                  ],
                },
              ],
            },
          ],
          usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 },
        }),
      ),
    );
    const restarted = new ResearchService(storage, request);
    const result = await restarted.execute({ action: "poll", id });
    expect(request.mock.calls[1]![0]).toBe("https://api.openai.com/v1/responses/resp_test");
    expect(result.jobs[0]).toMatchObject({
      status: "completed",
      report: "Findings — 日本語",
      sources: [{ title: "Study", url: "https://example.org/study" }],
      usage: { totalTokens: 46 },
    });
    await restarted.execute({ action: "poll", id });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not retry an uncertain start and requires explicit reconciliation", async () => {
    const { service, request, ready } = fixture();
    await ready();
    request.mockRejectedValueOnce(new Error("private upstream diagnostics"));
    const result = await service.execute(start);
    expect(result.jobs[0]?.status).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("private upstream diagnostics");
    await service.execute(start);
    await service.execute({ ...prepare, id: id2 });
    await expect(service.execute({ ...start, id: id2 })).rejects.toThrow("active API research");
    await expect(service.execute({ action: "cancel", id })).rejects.toThrow("no response ID");
    await expect(service.execute({ action: "remove-key" })).rejects.toThrow("active research");
    expect(request).toHaveBeenCalledTimes(1);
    await service.execute({ action: "resolve-unknown", id });
    expect((await service.execute({ action: "delete", id })).jobs).toHaveLength(1);
  });

  it("records definite rejection without copying provider diagnostics", async () => {
    const { service, request, ready } = fixture();
    await ready();
    request.mockResolvedValueOnce(new Response(key, { status: 401 }));
    const result = await service.execute(start);
    expect(result.jobs[0]).toMatchObject({ status: "failed" });
    expect(result.jobs[0]?.error).toContain("401");
    expect(JSON.stringify(result)).not.toContain(key);
    await service.execute({ action: "remove-key" });
  });

  it("never starts paid work when the start marker cannot be saved", async () => {
    const { service, request, storage, ready } = fixture();
    await ready();
    storage.set.mockRejectedValueOnce(new Error("disk full"));
    await expect(service.execute(start)).rejects.toThrow("disk full");
    expect(request).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])("keeps unavailable runs recoverable after HTTP %s", async (status) => {
    const { service, request, ready } = fixture();
    await ready();
    await service.execute(start);
    request.mockResolvedValueOnce(new Response("private diagnostics", { status }));
    const result = await service.execute({ action: "poll", id });
    expect(result.jobs[0]).toMatchObject({ status: "unknown", responseId: "resp_test" });
    expect(JSON.stringify(result)).not.toContain("private diagnostics");
    await service.execute({ ...prepare, id: id2 });
    await expect(service.execute({ ...start, id: id2 })).rejects.toThrow("active API research");
    await service.execute({ action: "resolve-unknown", id });
    await service.execute({ action: "remove-key" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not treat an upstream request timeout as a definite rejection", async () => {
    const { service, request, ready } = fixture();
    await ready();
    request.mockResolvedValueOnce(new Response("", { status: 408 }));
    expect((await service.execute(start)).jobs[0]?.status).toBe("unknown");
    await service.execute(start);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("recovers a known uncertain response without submitting another paid run", async () => {
    const { service, request, ready } = fixture();
    await ready();
    await service.execute(start);
    request.mockResolvedValueOnce(new Response("", { status: 404 }));
    await service.execute({ action: "cancel", id });
    request.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resp_test", status: "completed" })),
    );
    expect((await service.execute({ action: "poll", id })).jobs[0]?.status).toBe("completed");
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "POST", "GET"]);
    expect(request.mock.calls[1]?.[0]).toBe("https://api.openai.com/v1/responses/resp_test/cancel");
    expect(request.mock.calls[2]?.[0]).toBe("https://api.openai.com/v1/responses/resp_test");
  });

  it("does not repeat paid work when saving its response fails before restart", async () => {
    const { service, storage, request, ready } = fixture();
    await ready();
    const write = storage.set.getMockImplementation()!;
    storage.set
      .mockImplementationOnce(write)
      .mockRejectedValueOnce(new Error("disk full after POST"));
    await expect(service.execute(start)).rejects.toThrow("disk full after POST");
    const restarted = new ResearchService(storage, request);
    expect((await restarted.execute(start)).jobs[0]?.status).toBe("unknown");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("turns citation offsets into inline links without losing cited prose", async () => {
    const { service, request, ready } = fixture();
    await ready();
    const text = "Evidence. \uE200cite\uE202turn0search0\uE201 More evidence.";
    const markerStart = text.indexOf("\uE200");
    const markerEnd = text.indexOf("\uE201") + 1;
    request.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "resp_test",
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text,
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://example.org/study",
                      start_index: markerStart,
                      end_index: markerEnd,
                    },
                    {
                      type: "url_citation",
                      url: "https://example.org/second",
                      start_index: markerEnd + 1,
                      end_index: text.length,
                    },
                    {
                      type: "url_citation",
                      url: "https://example.org/study",
                      start_index: markerEnd + 1,
                      end_index: text.length,
                    },
                    {
                      type: "url_citation",
                      url: "javascript:alert(1)",
                      start_index: 0,
                      end_index: 1,
                    },
                    {
                      type: "url_citation",
                      url: "https://example.org/invalid-offset",
                      start_index: -1,
                      end_index: 99999,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const report = (await service.execute(start)).jobs[0]?.report;
    expect(report).toContain("[1](<https://example.org/study>)");
    expect(report).toContain("More evidence. [2](<https://example.org/second>)");
    expect(report).toContain("[2](<https://example.org/second>) [1](<https://example.org/study>)");
    expect(report).not.toContain("turn0search0");
    expect(report).not.toContain("javascript:");
    expect(report).toContain("Evidence.");
  });

  it("cancels the existing response and allows deleting the local report", async () => {
    const { service, request, ready } = fixture();
    await ready();
    await service.execute(start);
    await expect(service.execute({ action: "delete", id })).rejects.toThrow("Cancel");
    request.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resp_test", status: "cancelled" })),
    );
    expect((await service.execute({ action: "cancel", id })).jobs[0]?.status).toBe("cancelled");
    expect(request.mock.calls[1]![0]).toBe("https://api.openai.com/v1/responses/resp_test/cancel");
    expect((await service.execute({ action: "delete", id })).jobs).toEqual([]);
  });

  it("rejects path injection, unbounded budgets, unknown models, and oversized prompts", () => {
    const invalid: unknown[] = [
      { action: "poll", id: "../../secrets" },
      { ...start, maxToolCalls: 100000 },
      { ...start, model: "any-model" },
      { ...prepare, prompt: "x".repeat(30001) },
      { action: "configure", key: "sk-secret\r\nInjected: yes" },
    ];
    for (const action of invalid) expect(() => decode(action)).toThrow();
    const valid: ResearchAction = decode(start);
    expect(valid).toEqual(start);
  });
});
