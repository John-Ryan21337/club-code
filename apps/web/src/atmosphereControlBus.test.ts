import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetAtmosphereControlHandlersForTests,
  registerAtmosphereControlHandler,
  requestAtmosphereControl,
} from "./atmosphereControlBus";

afterEach(() => {
  __resetAtmosphereControlHandlersForTests();
});

describe("atmosphere control bus", () => {
  it("uses the first handler that owns an action", async () => {
    const first = vi.fn(() => ({ handled: false, message: "not mine" }));
    const second = vi.fn(() => ({ handled: true, message: "Skipped." }));
    registerAtmosphereControlHandler(first);
    registerAtmosphereControlHandler(second);

    await expect(requestAtmosphereControl({ kind: "media", action: "next" })).resolves.toEqual({
      handled: true,
      message: "Skipped.",
    });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("fails closed when no live surface can handle the request", async () => {
    registerAtmosphereControlHandler(() => {
      throw new Error("detached");
    });
    await expect(
      requestAtmosphereControl({ kind: "visualizer", action: "random" }),
    ).resolves.toEqual({
      handled: false,
      message: "The visualizer is not ready.",
    });
  });
});
