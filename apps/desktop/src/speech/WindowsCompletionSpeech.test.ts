import { describe, expect, it, vi } from "vitest";

import {
  getWindowsCompletionSpeechCapability,
  synthesizeWindowsCompletionSpeech,
} from "./WindowsCompletionSpeech.ts";

function shortPcmWav(durationSeconds = 0.01): Buffer {
  const bytesPerSecond = 8_000;
  const dataBytes = Math.max(1, Math.ceil(bytesPerSecond * durationSeconds));
  const paddedDataBytes = dataBytes + (dataBytes % 2);
  const wav = Buffer.alloc(44 + paddedDataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8_000, 24);
  wav.writeUInt32LE(bytesPerSecond, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

describe("WindowsCompletionSpeech", () => {
  it("reports native synthesis as unavailable without launching PowerShell off Windows", async () => {
    const runPowerShell = vi.fn();
    const result = await getWindowsCompletionSpeechCapability({
      platform: "darwin",
      runPowerShell,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toContain("Windows");
    expect(runPowerShell).not.toHaveBeenCalled();
  });

  it("lists only valid English and Japanese gendered voices", async () => {
    const result = await getWindowsCompletionSpeechCapability({
      platform: "win32",
      runPowerShell: async () =>
        JSON.stringify([
          { name: "English Voice", language: "en", culture: "en-US", gender: "female" },
          { name: "Japanese Voice", language: "ja", culture: "ja-JP", gender: "male" },
          { name: "Ignored", language: "fr", culture: "fr-FR", gender: "female" },
        ]),
    });
    expect(result).toMatchObject({
      available: true,
      reason: null,
      voices: [
        { name: "English Voice", language: "en", gender: "female" },
        { name: "Japanese Voice", language: "ja", gender: "male" },
      ],
    });
  });

  it("deduplicates and bounds voice capability metadata at the IPC contract limit", async () => {
    const voices = Array.from({ length: 140 }, (_, index) => ({
      name: `English Voice ${index}`,
      language: "en",
      culture: "en-US",
      gender: "female",
    }));
    voices.splice(1, 0, voices[0]!);

    const result = await getWindowsCompletionSpeechCapability({
      platform: "win32",
      runPowerShell: async () => JSON.stringify(voices),
    });

    expect(result.voices).toHaveLength(128);
    expect(result.voices[0]?.name).toBe("English Voice 0");
    expect(result.voices[1]?.name).toBe("English Voice 1");
  });

  it("synthesizes only the fixed enum request and cleans its temporary directory", async () => {
    const removeTempDirectory = vi.fn(async () => {});
    const runPowerShell = vi.fn(async (script, environment) => {
      const haruka = script.indexOf("Microsoft Haruka Desktop");
      const ayumi = script.indexOf("Microsoft Ayumi Desktop");
      const zira = script.indexOf("Microsoft Zira Desktop");
      expect(haruka).toBeGreaterThan(-1);
      expect(ayumi).toBeGreaterThan(haruka);
      expect(zira).toBeGreaterThan(ayumi);
      expect(script).toContain("$match = $matches | Select-Object -First 1");
      expect(script).toContain("作業が完了しました。");
      expect(environment).toEqual({
        CAFE_CODE_SPEECH_LANGUAGE: "ja",
        CAFE_CODE_SPEECH_GENDER: "female",
        CAFE_CODE_SPEECH_OUTPUT: "C:\\safe-temp\\completion.wav",
      });
      return JSON.stringify({
        unavailable: false,
        name: "Japanese Voice",
        language: "ja",
        culture: "ja-JP",
        gender: "female",
      });
    });
    const result = await synthesizeWindowsCompletionSpeech(
      { language: "ja", gender: "female" },
      {
        platform: "win32",
        runPowerShell,
        makeTempDirectory: async () => "C:\\safe-temp",
        readWav: async () => shortPcmWav(),
        removeTempDirectory,
      },
    );
    expect(result.clip?.voice.name).toBe("Japanese Voice");
    expect(result.clip?.wavBase64).toBe(shortPcmWav().toString("base64"));
    expect(removeTempDirectory).toHaveBeenCalledWith("C:\\safe-temp");
  });

  it("does not substitute a different voice when the requested match is absent", async () => {
    const result = await synthesizeWindowsCompletionSpeech(
      { language: "en", gender: "male" },
      {
        platform: "win32",
        runPowerShell: async () => JSON.stringify({ unavailable: true }),
        makeTempDirectory: async () => "C:\\safe-temp",
        removeTempDirectory: async () => {},
      },
    );
    expect(result.clip).toBeNull();
    expect(result.reason).toContain("English male");
  });

  it("rejects oversized native output and still cleans up", async () => {
    const removeTempDirectory = vi.fn(async () => {});
    const result = await synthesizeWindowsCompletionSpeech(
      { language: "en", gender: "female" },
      {
        platform: "win32",
        runPowerShell: async () =>
          JSON.stringify({
            unavailable: false,
            name: "English Voice",
            language: "en",
            culture: "en-US",
            gender: "female",
          }),
        makeTempDirectory: async () => "C:\\safe-temp",
        readWav: async () => Buffer.alloc(1_000_001),
        removeTempDirectory,
      },
    );
    expect(result.clip).toBeNull();
    expect(result.reason).toContain("safe short WAV");
    expect(removeTempDirectory).toHaveBeenCalledOnce();
  });

  it("rejects malformed, overlong, and culture-mismatched native results", async () => {
    const baseDependencies = {
      platform: "win32" as const,
      makeTempDirectory: async () => "C:\\safe-temp",
      removeTempDirectory: async () => {},
    };
    const metadata = {
      unavailable: false,
      name: "English Voice",
      language: "en",
      culture: "en-US",
      gender: "female",
    };

    await expect(
      synthesizeWindowsCompletionSpeech(
        { language: "en", gender: "female" },
        {
          ...baseDependencies,
          runPowerShell: async () => JSON.stringify(metadata),
          readWav: async () => Buffer.from("not a WAV"),
        },
      ),
    ).resolves.toMatchObject({ clip: null, reason: expect.stringContaining("safe short WAV") });

    await expect(
      synthesizeWindowsCompletionSpeech(
        { language: "en", gender: "female" },
        {
          ...baseDependencies,
          runPowerShell: async () => JSON.stringify(metadata),
          readWav: async () => shortPcmWav(15.01),
        },
      ),
    ).resolves.toMatchObject({ clip: null, reason: expect.stringContaining("safe short WAV") });

    await expect(
      synthesizeWindowsCompletionSpeech(
        { language: "en", gender: "female" },
        {
          ...baseDependencies,
          runPowerShell: async () => JSON.stringify({ ...metadata, culture: "ja-JP" }),
          readWav: async () => shortPcmWav(),
        },
      ),
    ).resolves.toMatchObject({
      clip: null,
      reason: expect.stringContaining("invalid voice metadata"),
    });
  });
});
