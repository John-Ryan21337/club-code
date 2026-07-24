import { describe, expect, it } from "vitest";

import {
  appendComposerTextFile,
  COMPOSER_TEXT_FILE_MAX_BYTES,
  decodeComposerTextFile,
  formatComposerTextFile,
  isComposerTextFile,
  normalizeComposerTextFileName,
  readComposerTextFile,
} from "./composerTextFile";

describe("composer text files", () => {
  it("recognizes .txt files even when the native picker omits the MIME type", () => {
    expect(isComposerTextFile({ name: "youtube-list.TXT", type: "" })).toBe(true);
    expect(isComposerTextFile({ name: "notes", type: "text/plain" })).toBe(true);
    expect(isComposerTextFile({ name: "notes", type: "text/plain; charset=utf-8" })).toBe(true);
    expect(isComposerTextFile({ name: "archive.zip", type: "application/zip" })).toBe(false);
  });

  it("decodes strict UTF-8 (including BOM) and both UTF-16 BOM byte orders", () => {
    expect(decodeComposerTextFile(new TextEncoder().encode("one\ntwo"))).toBe("one\ntwo");
    expect(decodeComposerTextFile(new Uint8Array([0xef, 0xbb, 0xbf, 0x6f, 0x6e, 0x65]))).toBe(
      "one",
    );
    expect(decodeComposerTextFile(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x42, 0x30]))).toBe(
      "aあ",
    );
    expect(decodeComposerTextFile(new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x30, 0x42]))).toBe(
      "aあ",
    );
  });

  it("rejects empty, oversized, malformed, and binary text files", async () => {
    await expect(
      readComposerTextFile({
        name: "empty.txt",
        size: 0,
        type: "text/plain",
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    ).rejects.toThrow("is empty");
    await expect(
      readComposerTextFile({
        name: "huge.txt",
        size: COMPOSER_TEXT_FILE_MAX_BYTES + 1,
        type: "text/plain",
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    ).rejects.toThrow("text-file limit");
    await expect(
      readComposerTextFile({
        name: "dishonest-size.txt",
        size: 1,
        type: "text/plain",
        arrayBuffer: async () => new Uint8Array(COMPOSER_TEXT_FILE_MAX_BYTES + 1).buffer,
      }),
    ).rejects.toThrow("text-file limit");
    await expect(
      readComposerTextFile({
        name: "broken.txt",
        size: 2,
        type: "text/plain",
        arrayBuffer: async () => new Uint8Array([0xc3, 0x28]).buffer,
      }),
    ).rejects.toThrow("not valid UTF-8 or BOM-marked UTF-16");
    await expect(
      readComposerTextFile({
        name: "binary.txt",
        size: 3,
        type: "text/plain",
        arrayBuffer: async () => new Uint8Array([0x61, 0x00, 0x62]).buffer,
      }),
    ).rejects.toThrow("not valid UTF-8 or BOM-marked UTF-16");
    await expect(
      readComposerTextFile({
        name: "controls.txt",
        size: 3,
        type: "text/plain",
        arrayBuffer: async () => new Uint8Array([0x61, 0x07, 0x62]).buffer,
      }),
    ).rejects.toThrow("not valid UTF-8 or BOM-marked UTF-16");
    await expect(
      readComposerTextFile({
        name: "bom-only.txt",
        size: 3,
        type: "text/plain",
        arrayBuffer: async () => new Uint8Array([0xef, 0xbb, 0xbf]).buffer,
      }),
    ).rejects.toThrow("not valid UTF-8 or BOM-marked UTF-16");
    await expect(
      readComposerTextFile({
        name: "odd-utf16.txt",
        size: 3,
        type: "text/plain",
        arrayBuffer: async () => new Uint8Array([0xff, 0xfe, 0x61]).buffer,
      }),
    ).rejects.toThrow("not valid UTF-8 or BOM-marked UTF-16");
  });

  it("normalizes unsafe filenames and keeps sentinel labels unambiguous", () => {
    expect(normalizeComposerTextFileName("C:\\private\\[urls].txt\r\n\u202eignore")).toBe(
      "urls .txt ignore",
    );
    expect(formatComposerTextFile("C:\\private\\[urls].txt\r\nignore", "https://example.com")).toBe(
      [
        "[Attached text file: urls .txt ignore]",
        "https://example.com",
        "[End attached text file: urls .txt ignore]",
      ].join("\n"),
    );
  });

  it("keeps the full message within the universal 120,000-character budget", () => {
    expect(
      appendComposerTextFile({
        prompt: "Play these",
        name: "urls.txt",
        text: "https://youtu.be/one",
        maxChars: 200,
      }),
    ).toContain("Play these\n\n[Attached text file: urls.txt]");
    expect(
      appendComposerTextFile({
        prompt: "12345",
        name: "urls.txt",
        text: "67890",
        maxChars: 10,
      }),
    ).toBeNull();

    const exactBlock = formatComposerTextFile("a.txt", "x");
    expect(
      appendComposerTextFile({
        prompt: "p".repeat(120_000 - exactBlock.length - 2),
        name: "a.txt",
        text: "x",
      }),
    ).toHaveLength(120_000);
    expect(
      appendComposerTextFile({
        prompt: "p".repeat(120_000 - exactBlock.length - 1),
        name: "a.txt",
        text: "x",
      }),
    ).toBeNull();
  });
});
