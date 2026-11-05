import { describe, expect, it } from "vitest";
import { ProviderInstanceId } from "@cafecode/contracts";
import { codexContextWindowDescriptor, resolveCodexContextWindow } from "./CodexContextWindow.ts";

describe("Codex context budgets", () => {
  const selection = (model: string, value?: string) => ({
    instanceId: ProviderInstanceId.make("codex"),
    model,
    ...(value ? { options: [{ id: "contextWindow", value }] } : {}),
  });
  it("uses a smaller explicit budget and offers only pinned capacities", () => {
    expect(resolveCodexContextWindow(selection("gpt-6-astra"))).toBe(200_000);
    expect(codexContextWindowDescriptor("gpt-6-astra")).toMatchObject({
      currentValue: "200k",
      options: [{ id: "200k" }, { id: "272k" }, { id: "872k" }],
    });
    expect(resolveCodexContextWindow(selection("gpt-6.1-terra", "500k"))).toBe(500_000);
    expect(resolveCodexContextWindow(selection("gpt-6-astra", "872k"))).toBe(872_000);
    expect(resolveCodexContextWindow(selection("gpt-5.5", "872k"))).toBe(200_000);
    expect(resolveCodexContextWindow(selection("gpt-6-astra", "1m"))).toBe(200_000);
  });
  it("does not set hosted capacities for unknown, local, absent or prototype names", () => {
    for (const model of ["custom", "local-model", "constructor", "toString"]) {
      expect(codexContextWindowDescriptor(model)).toBeUndefined();
      expect(resolveCodexContextWindow(selection(model, "200k"))).toBeUndefined();
    }
    expect(resolveCodexContextWindow(selection("gpt-6-astra"), true)).toBeUndefined();
    expect(resolveCodexContextWindow(undefined)).toBeUndefined();
  });
});
