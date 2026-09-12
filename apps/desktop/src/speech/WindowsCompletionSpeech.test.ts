import { stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildWindowsSpeechChildEnvironment,
  getWindowsCompletionSpeechCapability,
  synthesizeWindowsCompletionSpeech,
  WINDOWS_COMPLETION_SPEECH_SCRIPTS,
  windowsPowerShellExecutablePath,
  type WindowsCompletionSpeechDependencies,
} from "./WindowsCompletionSpeech.ts";

const speechFixtureDirectory = join(tmpdir(), "cafe-code-speech-fixture");

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
    const runPowerShell = vi.fn<NonNullable<WindowsCompletionSpeechDependencies["runPowerShell"]>>(
      async () =>
        JSON.stringify({
          unavailable: false,
          name: "Japanese Voice",
          language: "ja",
          culture: "ja-JP",
          gender: "female",
        }),
    );
    const readWav = vi.fn(async () => shortPcmWav());
    const result = await synthesizeWindowsCompletionSpeech(
      { language: "ja", gender: "female" },
      {
        platform: "win32",
        runPowerShell,
        makeTempDirectory: async () => speechFixtureDirectory,
        readWav,
        removeTempDirectory,
      },
    );
    // Assert after synthesis: the native boundary intentionally catches runner
    // errors, which would otherwise conceal a failing assertion in the mock.
    expect(runPowerShell).toHaveBeenCalledOnce();
    const [script, environment] = runPowerShell.mock.calls[0]!;
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
      CAFE_CODE_SPEECH_OUTPUT: join(speechFixtureDirectory, "completion.wav"),
    });
    expect(readWav).toHaveBeenCalledExactlyOnceWith(join(speechFixtureDirectory, "completion.wav"));
    expect(result.clip?.voice.name).toBe("Japanese Voice");
    expect(result.clip?.wavBase64).toBe(shortPcmWav().toString("base64"));
    expect(result.reason).toBeNull();
    expect(removeTempDirectory).toHaveBeenCalledExactlyOnceWith(speechFixtureDirectory);
  });

  it("does not substitute a different voice when the requested match is absent", async () => {
    const result = await synthesizeWindowsCompletionSpeech(
      { language: "en", gender: "male" },
      {
        platform: "win32",
        runPowerShell: async () => JSON.stringify({ unavailable: true }),
        makeTempDirectory: async () => speechFixtureDirectory,
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
        makeTempDirectory: async () => speechFixtureDirectory,
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
      makeTempDirectory: async () => speechFixtureDirectory,
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

describe("WindowsCompletionSpeech child process boundary", () => {
  it("passes request values only as environment variables, never interpolated into the script", () => {
    for (const script of Object.values(WINDOWS_COMPLETION_SPEECH_SCRIPTS)) {
      // The scripts are fixed literals: every per-request value is read back out
      // of $env:, so nothing caller-controlled is ever parsed as PowerShell.
      expect(script).not.toContain("${");
      expect(script).not.toContain("`");
    }
    expect(WINDOWS_COMPLETION_SPEECH_SCRIPTS.synthesize).toContain(
      "$language = $env:CAFE_CODE_SPEECH_LANGUAGE",
    );
    expect(WINDOWS_COMPLETION_SPEECH_SCRIPTS.synthesize).toContain(
      "$outputPath = $env:CAFE_CODE_SPEECH_OUTPUT",
    );
    // The script re-validates the enums even though the IPC schema already did.
    expect(WINDOWS_COMPLETION_SPEECH_SCRIPTS.synthesize).toContain(
      "($language -ne 'en' -and $language -ne 'ja')",
    );
  });

  it("spawns the system console host by absolute path instead of a PATH lookup", () => {
    vi.stubEnv("SystemRoot", "C:\\TestWindows");
    try {
      expect(windowsPowerShellExecutablePath()).toBe(
        join("C:\\TestWindows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not leak provider credentials or a hijackable PATH into the speech child", () => {
    vi.stubEnv("CAFE_CODE_TEST_PROVIDER_TOKEN", "super-secret-token");
    vi.stubEnv("Path", "C:\\attacker\\bin");
    vi.stubEnv("SystemRoot", "C:\\TestWindows");
    try {
      const environment = buildWindowsSpeechChildEnvironment({
        CAFE_CODE_SPEECH_LANGUAGE: "ja",
      });
      expect(environment).not.toHaveProperty("CAFE_CODE_TEST_PROVIDER_TOKEN");
      expect(Object.values(environment).join(";")).not.toContain("super-secret-token");
      expect(environment.Path).not.toContain("attacker");
      expect(environment.Path?.split(";")[0]).toBe(join("C:\\TestWindows", "System32"));
      // The validated request value wins over anything ambient.
      expect(environment.CAFE_CODE_SPEECH_LANGUAGE).toBe("ja");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

async function listSyntheticVoice(name: string) {
  return await getWindowsCompletionSpeechCapability({
    platform: "win32",
    runPowerShell: async () =>
      JSON.stringify([{ name, language: "ja", culture: "ja-JP", gender: "female" }]),
  });
}

describe("WindowsCompletionSpeech result boundaries", () => {
  const japaneseVoice = {
    unavailable: false,
    name: "Microsoft ハルカ Desktop",
    language: "ja",
    culture: "ja-JP",
    gender: "female",
  };

  it("keeps non-ASCII voice metadata intact and pins UTF-8 console output", async () => {
    const capability = await getWindowsCompletionSpeechCapability({
      platform: "win32",
      runPowerShell: async () =>
        JSON.stringify([
          { name: "Microsoft ハルカ Desktop", language: "ja", culture: "ja-JP", gender: "female" },
          { name: "Microsoft ハルカ Desktop", language: "ja", culture: "ja-JP", gender: "female" },
          { name: "Microsoft Zira Desktop", language: "en", culture: "en-US", gender: "female" },
        ]),
    });
    expect(capability.voices).toEqual([
      { name: "Microsoft ハルカ Desktop", culture: "ja-JP", language: "ja", gender: "female" },
      { name: "Microsoft Zira Desktop", culture: "en-US", language: "en", gender: "female" },
    ]);

    const synthesized = await synthesizeWindowsCompletionSpeech(
      { language: "ja", gender: "female" },
      {
        platform: "win32",
        runPowerShell: async () => JSON.stringify(japaneseVoice),
        makeTempDirectory: async () => speechFixtureDirectory,
        readWav: async () => shortPcmWav(),
        removeTempDirectory: async () => {},
      },
    );
    expect(synthesized.clip?.voice.name).toBe("Microsoft ハルカ Desktop");

    // Without this the console host emits the active Windows code page and a
    // Japanese voice name reaches us as mojibake that fails the JSON decode.
    for (const script of Object.values(WINDOWS_COMPLETION_SPEECH_SCRIPTS)) {
      expect(script).toContain("[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)");
    }
  });

  it("bounds multi-byte voice names at the metadata limit", async () => {
    const atLimit = "あ".repeat(512);
    const overLimit = "あ".repeat(513);
    expect((await listSyntheticVoice(atLimit)).voices).toHaveLength(1);
    expect((await listSyntheticVoice(overLimit)).voices).toHaveLength(0);
  });

  it("reads and removes a real temporary directory through the default filesystem path", async () => {
    let outputPath = "";
    const result = await synthesizeWindowsCompletionSpeech(
      { language: "ja", gender: "female" },
      {
        platform: "win32",
        runPowerShell: async (_script, environment) => {
          outputPath = environment?.CAFE_CODE_SPEECH_OUTPUT ?? "";
          await writeFile(outputPath, shortPcmWav());
          return JSON.stringify(japaneseVoice);
        },
      },
    );
    expect(result.reason).toBeNull();
    expect(result.clip?.wavBase64).toBe(shortPcmWav().toString("base64"));
    await expect(stat(dirname(outputPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports a real over-limit file as an unsafe WAV and still removes its directory", async () => {
    let outputPath = "";
    const result = await synthesizeWindowsCompletionSpeech(
      { language: "ja", gender: "female" },
      {
        platform: "win32",
        runPowerShell: async (_script, environment) => {
          outputPath = environment?.CAFE_CODE_SPEECH_OUTPUT ?? "";
          // One byte past the limit: the bounded read must stop there and the
          // caller must name the real problem rather than a synthesis failure.
          await writeFile(outputPath, Buffer.alloc(1_000_001));
          return JSON.stringify(japaneseVoice);
        },
      },
    );
    expect(result.clip).toBeNull();
    expect(result.reason).toContain("safe short WAV");
    await expect(stat(dirname(outputPath))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
