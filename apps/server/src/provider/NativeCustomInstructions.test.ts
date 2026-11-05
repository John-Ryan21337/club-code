import { describe, expect, it } from "vitest";
import { composeNativeCustomInstructions } from "./NativeCustomInstructions.ts";

describe("native custom instructions", () => {
  it("omits blank guidance so native defaults remain intact", () => {
    expect(composeNativeCustomInstructions(undefined)).toBeUndefined();
    expect(composeNativeCustomInstructions(" \n\t ")).toBeUndefined();
  });
  it("preserves guidance content while identifying its user origin", () => {
    expect(composeNativeCustomInstructions("  Follow project rules.\nKeep examples.  ")).toBe(
      "<user-instructions>\nFollow project rules.\nKeep examples.\n</user-instructions>",
    );
  });
});
