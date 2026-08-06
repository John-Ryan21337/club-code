import type { DesktopBridge } from "@cafecode/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "../lib/copyToClipboard";

const originalDesktopBridge = window.desktopBridge;
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");

afterEach(() => {
  if (originalDesktopBridge) {
    window.desktopBridge = originalDesktopBridge;
  } else {
    Reflect.deleteProperty(window, "desktopBridge");
  }
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
  if (originalExecCommandDescriptor) {
    Object.defineProperty(document, "execCommand", originalExecCommandDescriptor);
  } else {
    Reflect.deleteProperty(document, "execCommand");
  }
  vi.restoreAllMocks();
});

describe("copyTextToClipboard", () => {
  it("uses the native desktop clipboard bridge when available", async () => {
    const copyText = vi.fn(async () => undefined);
    window.desktopBridge = { copyText } as unknown as DesktopBridge;

    await copyTextToClipboard("prompt history");

    expect(copyText).toHaveBeenCalledExactlyOnceWith("prompt history");
  });

  it("falls back to a selection copy when the browser clipboard rejects", async () => {
    Reflect.deleteProperty(window, "desktopBridge");
    const writeText = vi.fn(async () => {
      throw new Error("permission denied");
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await copyTextToClipboard("chat history");

    expect(writeText).toHaveBeenCalledExactlyOnceWith("chat history");
    expect(execCommand).toHaveBeenCalledExactlyOnceWith("copy");
  });
});
