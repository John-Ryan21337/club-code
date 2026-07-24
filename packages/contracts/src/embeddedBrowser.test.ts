import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  EMBEDDED_BROWSER_MAX_TYPE_CHARS,
  EMBEDDED_BROWSER_MAX_URL_CHARS,
  AgentBrowserGrantInputSchema,
  AgentBrowserCompleteInputSchema,
  AgentBrowserActionSchema,
  EmbeddedBrowserClickInputSchema,
  EmbeddedBrowserNavigateInputSchema,
  EmbeddedBrowserSetBoundsInputSchema,
  EmbeddedBrowserSnapshotSchema,
  EmbeddedBrowserTypeInputSchema,
} from "./embeddedBrowser.js";

const decodeNavigate = Schema.decodeUnknownSync(EmbeddedBrowserNavigateInputSchema);
const decodeBounds = Schema.decodeUnknownSync(EmbeddedBrowserSetBoundsInputSchema);
const decodeClick = Schema.decodeUnknownSync(EmbeddedBrowserClickInputSchema);
const decodeType = Schema.decodeUnknownSync(EmbeddedBrowserTypeInputSchema);
const encodeSnapshot = Schema.encodeUnknownSync(EmbeddedBrowserSnapshotSchema);
const decodeAgentGrant = Schema.decodeUnknownSync(AgentBrowserGrantInputSchema);
const decodeAgentComplete = Schema.decodeUnknownSync(AgentBrowserCompleteInputSchema);
const decodeAgentAction = Schema.decodeUnknownSync(AgentBrowserActionSchema);

describe("embedded browser IPC contracts", () => {
  it("bounds URL and view geometry inputs", () => {
    expect(
      decodeNavigate({
        tabId: "tab_1",
        url: "https://portal.example",
      }),
    ).toEqual({
      tabId: "tab_1",
      url: "https://portal.example",
    });
    expect(() =>
      decodeNavigate({
        tabId: "tab_1",
        url: "x".repeat(EMBEDDED_BROWSER_MAX_URL_CHARS + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeBounds({
        tabId: "tab_1",
        bounds: { x: -1, y: 0, width: 100, height: 100 },
      }),
    ).toThrow();
  });

  it("accepts only opaque tab/snapshot IDs and enumerated target IDs", () => {
    expect(
      decodeClick({
        tabId: "tab-1",
        snapshotId: "snapshot_1",
        targetId: "e12",
      }),
    ).toEqual({
      tabId: "tab-1",
      snapshotId: "snapshot_1",
      targetId: "e12",
    });
    expect(() =>
      decodeClick({
        tabId: "../other-tab",
        snapshotId: "snapshot_1",
        targetId: "#password",
      }),
    ).toThrow();
  });

  it("bounds transient typing values and requires an explicit sensitivity flag", () => {
    expect(
      decodeType({
        tabId: "tab-1",
        snapshotId: "snapshot-1",
        targetId: "e1",
        value: "one-time",
        sensitive: true,
      }),
    ).toMatchObject({ value: "one-time", sensitive: true });
    expect(() =>
      decodeType({
        tabId: "tab-1",
        snapshotId: "snapshot-1",
        targetId: "e1",
        value: "x".repeat(EMBEDDED_BROWSER_MAX_TYPE_CHARS + 1),
        sensitive: true,
      }),
    ).toThrow();
    expect(() =>
      decodeType({
        tabId: "tab-1",
        snapshotId: "snapshot-1",
        targetId: "e1",
        value: "one-time",
      }),
    ).toThrow();
  });

  it("encodes snapshot timestamps across the IPC boundary as ISO strings", () => {
    expect(
      encodeSnapshot({
        snapshotId: "snapshot-1",
        mode: "dom-accessibility",
        displayUrl: "https://portal.example/account",
        title: "Account",
        capturedAt: "2026-07-23T12:00:00.000Z",
        text: "Visible text",
        targets: [],
        imageRegions: [],
        ocr: null,
        redactionNotice: "Likely secrets are omitted.",
      }),
    ).toMatchObject({ capturedAt: "2026-07-23T12:00:00.000Z" });
  });

  it("gates offline OCR to the packaged English and Japanese language identifiers", () => {
    expect(decodeAgentAction({ type: "ocr", language: "eng" })).toEqual({
      type: "ocr",
      language: "eng",
    });
    expect(decodeAgentAction({ type: "ocr", language: "jpn" })).toEqual({
      type: "ocr",
      language: "jpn",
    });
    expect(() => decodeAgentAction({ type: "ocr", language: "deu" })).toThrow();
    expect(() =>
      encodeSnapshot({
        snapshotId: "snapshot-ocr",
        mode: "ocr",
        displayUrl: "https://portal.example/",
        title: "Portal",
        capturedAt: "2026-07-23T12:00:00.000Z",
        text: "DOM text",
        targets: [],
        imageRegions: [],
        ocr: {
          status: "completed",
          engine: "tesseract.js@7.0.0",
          language: "eng",
          confidence: 101,
          truncated: false,
          text: "OCR text",
        },
        redactionNotice: "Likely secrets are omitted.",
      }),
    ).toThrow();
  });

  it("bounds agent grants and requires exact renderer completion correlation", () => {
    expect(
      decodeAgentGrant({
        threadId: "thread-1",
        providerInstanceId: "codex",
        tabId: "tab-1",
        origin: "https://portal.example",
        durationSeconds: 300,
      }),
    ).toMatchObject({ durationSeconds: 300, origin: "https://portal.example" });
    expect(() =>
      decodeAgentGrant({
        threadId: "thread-1",
        providerInstanceId: "codex",
        tabId: "tab-1",
        origin: "https://portal.example",
        durationSeconds: 3_600,
      }),
    ).toThrow();
    expect(() =>
      decodeAgentComplete({
        context: { tabId: "tab-1", origin: "https://portal.example" },
        requestId: "../wrong",
        result: { type: "snapshot", snapshot: null },
      }),
    ).toThrow();
  });
});
