import { describe, expect, it } from "vitest";

import { COMPLETION_ALERT_MAX_BYTES, inspectCompletionAlertFile } from "./completionAlertFiles";

function makeFile(name: string, type: string, size = 4): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("completion alert file validation", () => {
  it("accepts short decoded MP3 and WAV files", async () => {
    await expect(
      inspectCompletionAlertFile(makeFile("soft.mp3", "audio/mpeg"), async () => 2.25),
    ).resolves.toBe(2.25);
    await expect(
      inspectCompletionAlertFile(makeFile("soft.wav", "audio/wav"), async () => 1),
    ).resolves.toBe(1);
  });

  it("rejects unsupported, oversized, undecodable, and long files", async () => {
    await expect(
      inspectCompletionAlertFile(makeFile("notes.txt", "text/plain"), async () => 1),
    ).rejects.toThrow("MP3 or WAV");
    await expect(
      inspectCompletionAlertFile(
        makeFile("huge.wav", "audio/wav", COMPLETION_ALERT_MAX_BYTES + 1),
        async () => 1,
      ),
    ).rejects.toThrow("5 MiB");
    await expect(
      inspectCompletionAlertFile(makeFile("bad.wav", "audio/wav"), async () => {
        throw new Error("decode failed");
      }),
    ).rejects.toThrow("could not be decoded");
    await expect(
      inspectCompletionAlertFile(makeFile("long.mp3", "audio/mpeg"), async () => 15.01),
    ).rejects.toThrow("15 seconds");
  });
});
