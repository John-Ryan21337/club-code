import type {
  CompletionSpeechGender,
  CompletionSpeechLanguage,
  DesktopCompletionSpeechCapability,
  DesktopCompletionSpeechSynthesizeInput,
  DesktopCompletionSpeechSynthesizeResult,
  DesktopCompletionSpeechVoice,
} from "@cafecode/contracts";
import { execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const MAX_WAV_BYTES = 1_000_000;
// A fixed completion phrase must remain a short notification even if a broken
// or unexpected synthesis backend writes a tiny, very-low-bitrate WAV.
const MAX_WAV_DURATION_SECONDS = 15;
const POWERSHELL_TIMEOUT_MS = 12_000;
const POWERSHELL_MAX_BUFFER = 256 * 1024;
const MAX_VOICE_METADATA_LENGTH = 512;
const MAX_REPORTED_VOICES = 128;

const LIST_VOICES_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
    $info = $_.VoiceInfo
    $language = if ($info.Culture.Name.StartsWith('ja-', [System.StringComparison]::OrdinalIgnoreCase)) {
      'ja'
    } elseif ($info.Culture.Name.StartsWith('en-', [System.StringComparison]::OrdinalIgnoreCase)) {
      'en'
    } else {
      $null
    }
    $gender = if ($info.Gender -eq [System.Speech.Synthesis.VoiceGender]::Female) {
      'female'
    } elseif ($info.Gender -eq [System.Speech.Synthesis.VoiceGender]::Male) {
      'male'
    } else {
      $null
    }
    if ($null -ne $language -and $null -ne $gender) {
      [PSCustomObject]@{
        name = $info.Name
        language = $language
        culture = $info.Culture.Name
        gender = $gender
      }
    }
  })
  ConvertTo-Json -Compress -InputObject @($voices)
} finally {
  $synth.Dispose()
}
`;

const SYNTHESIZE_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech
$language = $env:CAFE_CODE_SPEECH_LANGUAGE
$gender = $env:CAFE_CODE_SPEECH_GENDER
$outputPath = $env:CAFE_CODE_SPEECH_OUTPUT
if (($language -ne 'en' -and $language -ne 'ja') -or
    ($gender -ne 'female' -and $gender -ne 'male') -or
    [string]::IsNullOrWhiteSpace($outputPath)) {
  throw 'Invalid fixed completion speech request.'
}
$culturePrefix = if ($language -eq 'ja') { 'ja-' } else { 'en-' }
$wantedGender = if ($gender -eq 'female') {
  [System.Speech.Synthesis.VoiceGender]::Female
} else {
  [System.Speech.Synthesis.VoiceGender]::Male
}
$phrase = if ($language -eq 'ja') { '作業が完了しました。' } else { 'Task complete.' }
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $matches = @($synth.GetInstalledVoices() |
    Where-Object {
      $_.Enabled -and
      $_.VoiceInfo.Culture.Name.StartsWith($culturePrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
      $_.VoiceInfo.Gender -eq $wantedGender
    })
  # Prefer familiar local female Windows voices where they are installed, but
  # only after the culture/gender filter above. This never turns an English
  # voice into Japanese or claims a different gender.
  $preferredNames = if ($language -eq 'ja' -and $gender -eq 'female') {
    @('Microsoft Haruka Desktop', 'Microsoft Ayumi Desktop')
  } elseif ($language -eq 'en' -and $gender -eq 'female') {
    @('Microsoft Zira Desktop')
  } else {
    @()
  }
  $match = $null
  foreach ($preferredName in $preferredNames) {
    $match = $matches |
      Where-Object { $_.VoiceInfo.Name.Equals($preferredName, [System.StringComparison]::OrdinalIgnoreCase) } |
      Select-Object -First 1
    if ($null -ne $match) { break }
  }
  if ($null -eq $match) {
    $match = $matches | Select-Object -First 1
  }
  if ($null -eq $match) {
    ConvertTo-Json -Compress -InputObject ([PSCustomObject]@{ unavailable = $true })
    exit 0
  }
  $info = $match.VoiceInfo
  $synth.SelectVoice($info.Name)
  $synth.SetOutputToWaveFile($outputPath)
  $synth.Speak($phrase)
  $synth.SetOutputToNull()
  ConvertTo-Json -Compress -InputObject ([PSCustomObject]@{
    unavailable = $false
    name = $info.Name
    language = $language
    culture = $info.Culture.Name
    gender = $gender
  })
} finally {
  $synth.Dispose()
}
`;

type PowerShellRunner = (
  script: string,
  environment?: Readonly<Record<string, string>>,
) => Promise<string>;

export interface WindowsCompletionSpeechDependencies {
  readonly platform?: NodeJS.Platform;
  readonly runPowerShell?: PowerShellRunner;
  readonly makeTempDirectory?: () => Promise<string>;
  readonly readWav?: (path: string) => Promise<Buffer>;
  readonly removeTempDirectory?: (path: string) => Promise<void>;
}

function encodedPowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * Only the Windows system-directory style entries a PowerShell host genuinely
 * needs to load `System.Speech` and write into our temporary directory.
 * Provider credentials, provider-home overrides, Node hooks, and user PATH
 * entries are deliberately dropped: the speech child is an untrusted-output OS
 * integration, not a provider process, so it must not inherit secrets it could
 * leak. This mirrors the repository rule already applied to document-extraction
 * children.
 */
const INHERITED_WINDOWS_ENVIRONMENT_KEYS = [
  "SystemRoot",
  "SystemDrive",
  "windir",
  "PATHEXT",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "CommonProgramFiles",
  "COMSPEC",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
] as const;

// Only a last-resort default: Windows always sets SystemRoot/windir, but a
// stripped environment must still produce a real absolute console-host path
// rather than a bare name that a PATH lookup could hijack.
const DEFAULT_WINDOWS_DIRECTORY = "C:\\Windows";

function windowsSystemRoot(): string {
  const root = process.env.SystemRoot ?? process.env.windir ?? DEFAULT_WINDOWS_DIRECTORY;
  if (
    !/^[A-Za-z]:[\\/]/u.test(root) ||
    /[\u0000-\u001f]/u.test(root) ||
    root.split(/[\\/]/u).some((part) => part === "..")
  )
    throw new Error("Windows system directory is invalid");
  return root;
}

/**
 * Exported for tests: build the bounded child environment without spawning.
 * `environment` holds the validated per-request values and wins over inherited
 * entries so a stale ambient variable can never select the spoken language.
 */
export function buildWindowsSpeechChildEnvironment(
  environment: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const key of INHERITED_WINDOWS_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) inherited[key] = value;
  }
  // Windows PowerShell still needs System32 on PATH for its own console host;
  // a fixed system-derived PATH keeps a hijacked user PATH out of the child.
  const systemRoot = windowsSystemRoot();
  inherited.Path = [
    join(systemRoot, "System32"),
    systemRoot,
    join(systemRoot, "System32", "Wbem"),
    join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
  ].join(";");
  return { ...inherited, ...environment };
}

/** Exported for tests: the absolute console host we spawn, never a PATH lookup. */
export function windowsPowerShellExecutablePath(): string {
  return join(windowsSystemRoot(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/**
 * Detach a helper we have given up on: kill it, drop our ends of its pipes so
 * they cannot hold the parent open, and stop waiting on it. The caller's
 * admission slot stays held until `execFile`'s callback reaps the process.
 */
function quarantineSpeechHelper(target: ChildProcess): void {
  try {
    target.kill("SIGKILL");
  } catch {
    /* Best effort. */
  }
  target.stdin?.destroy();
  target.stdout?.destroy();
  target.stderr?.destroy();
  target.unref();
}

/**
 * Never build a command string. The script travels as a UTF-16LE base64
 * `-EncodedCommand`, and the only per-request values (language, gender, output
 * path) travel as environment variables that the script re-validates against
 * fixed enums, so no caller-controlled text is ever parsed by a shell or by
 * PowerShell's expression parser.
 *
 * Caller settlement and helper lifetime are deliberately separate. `execFile`
 * bounds the child on wall clock (`timeout`, then `SIGKILL`), stdout size
 * (`maxBuffer`), console visibility (`windowsHide`), and shell use; but a
 * Windows process that ignores the kill would leave that callback pending
 * forever, so an independent 500 ms grace timer settles the caller at 12.5 s.
 * A helper that is still unreaped at that point is quarantined: it keeps its
 * admission slot (at most two exist) until Node actually reports it closed, so
 * a stuck helper degrades into "busy" instead of accumulating replacements.
 */
function createPowerShellRunner(execute: typeof execFile, timeoutMs: number): PowerShellRunner {
  let active = 0;
  return (script, environment = {}) =>
    new Promise<string>((resolve, reject) => {
      if (active >= 2) {
        reject(new Error("Speech helper is busy"));
        return;
      }
      active += 1;
      let reaped = false;
      let settled = false;
      let child: ChildProcess | null = null;
      let deadline: ReturnType<typeof setTimeout> | null = null;
      const finish = (error: unknown, output = "") => {
        if (settled) return;
        settled = true;
        if (deadline) clearTimeout(deadline);
        if (error) reject(error);
        else resolve(output.replace(/^\uFEFF/, "").trim());
      };
      const release = () => {
        if (!reaped) {
          reaped = true;
          active -= 1;
        }
      };
      try {
        child = execute(
          windowsPowerShellExecutablePath(),
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            encodedPowerShell(script),
          ],
          {
            encoding: "utf8",
            env: buildWindowsSpeechChildEnvironment(environment),
            cwd: join(windowsSystemRoot(), "System32"),
            windowsHide: true,
            timeout: timeoutMs,
            killSignal: "SIGKILL",
            maxBuffer: POWERSHELL_MAX_BUFFER,
            shell: false,
          },
          (error, stdout) => {
            release();
            finish(error, stdout);
          },
        );
        child.stdin?.end();
        if (!settled) {
          deadline = setTimeout(() => {
            if (child) quarantineSpeechHelper(child);
            finish(new Error("Speech helper did not finish"));
          }, timeoutMs + 500);
          deadline.unref();
        }
      } catch (error) {
        // A throw before `execute` returned (an invalid system directory, or a
        // spawner that fails synchronously) never consumed a helper, so the
        // slot is released immediately. A throw after the child exists gets the
        // same quarantine as a timeout.
        if (child) quarantineSpeechHelper(child);
        else release();
        finish(error);
      }
    });
}

const defaultPowerShellRunner = createPowerShellRunner(execFile, POWERSHELL_TIMEOUT_MS);

export function createWindowsSpeechRunnerForTest(
  execute: typeof execFile,
  timeoutMs = 10,
): PowerShellRunner {
  if (process.env.NODE_ENV !== "test") throw new Error("Speech runner override is test-only");
  return createPowerShellRunner(execute, timeoutMs);
}

async function readBoundedWav(path: string): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Speech output is not a regular file");
    // Read one byte past the limit rather than rejecting on the stat size: the
    // bounded read is what actually protects memory (the file can grow after
    // the stat), and returning the over-limit buffer lets the caller report an
    // oversized clip as an unsafe WAV instead of a synthesis failure.
    const buffer = Buffer.alloc(MAX_WAV_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    return buffer.subarray(0, total);
  } finally {
    await handle.close();
  }
}

function isLanguage(value: unknown): value is CompletionSpeechLanguage {
  return value === "en" || value === "ja";
}

function isGender(value: unknown): value is CompletionSpeechGender {
  return value === "female" || value === "male";
}

function cultureMatchesLanguage(culture: string, language: CompletionSpeechLanguage): boolean {
  return culture.toLowerCase().startsWith(`${language}-`);
}

function hasSafeVoiceText(value: string): boolean {
  return value.length > 0 && value.length <= MAX_VOICE_METADATA_LENGTH;
}

function decodeVoice(value: unknown): DesktopCompletionSpeechVoice | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.name !== "string" ||
    typeof candidate.culture !== "string" ||
    !isLanguage(candidate.language) ||
    !isGender(candidate.gender) ||
    !hasSafeVoiceText(candidate.name) ||
    !hasSafeVoiceText(candidate.culture) ||
    !cultureMatchesLanguage(candidate.culture, candidate.language)
  ) {
    return null;
  }
  return {
    name: candidate.name,
    culture: candidate.culture,
    language: candidate.language,
    gender: candidate.gender,
  };
}

/**
 * System.Speech writes PCM WAV, but validate the bounded result before it
 * crosses the desktop IPC boundary. This rejects malformed output and stops a
 * pathological low-bitrate file from turning a one-line alert into a long
 * monologue while keeping the renderer's AudioContext as a second decoder.
 */
function isShortWav(wav: Buffer): boolean {
  if (
    wav.byteLength < 44 ||
    wav.subarray(0, 4).toString("ascii") !== "RIFF" ||
    wav.subarray(8, 12).toString("ascii") !== "WAVE"
  ) {
    return false;
  }

  let averageBytesPerSecond: number | null = null;
  let dataBytes: number | null = null;
  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    const id = wav.subarray(offset, offset + 4).toString("ascii");
    const size = wav.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (size > wav.byteLength - dataOffset) return false;
    if (id === "fmt ") {
      if (size < 16) return false;
      const audioFormat = wav.readUInt16LE(dataOffset);
      const channels = wav.readUInt16LE(dataOffset + 2);
      const sampleRate = wav.readUInt32LE(dataOffset + 4);
      averageBytesPerSecond = wav.readUInt32LE(dataOffset + 8);
      if (audioFormat !== 1 || channels === 0 || sampleRate === 0 || averageBytesPerSecond === 0) {
        return false;
      }
    } else if (id === "data") {
      dataBytes = size;
    }
    offset = dataOffset + size + (size % 2);
  }

  return (
    averageBytesPerSecond !== null &&
    dataBytes !== null &&
    dataBytes / averageBytesPerSecond <= MAX_WAV_DURATION_SECONDS
  );
}

function unavailableCapability(reason: string): DesktopCompletionSpeechCapability {
  return {
    available: false,
    engine: "Windows System.Speech",
    voices: [],
    reason,
  };
}

export async function getWindowsCompletionSpeechCapability(
  dependencies: WindowsCompletionSpeechDependencies = {},
): Promise<DesktopCompletionSpeechCapability> {
  if ((dependencies.platform ?? process.platform) !== "win32") {
    return unavailableCapability(
      "Native stereo speech is available only in the Windows desktop app.",
    );
  }
  try {
    const raw = await (dependencies.runPowerShell ?? defaultPowerShellRunner)(LIST_VOICES_SCRIPT);
    const parsed: unknown = raw.length === 0 ? [] : JSON.parse(raw);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    const voices: DesktopCompletionSpeechVoice[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const voice = decodeVoice(value);
      if (!voice) continue;
      const identity = `${voice.language}\0${voice.culture.toLowerCase()}\0${voice.gender}\0${voice.name.toLowerCase()}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      voices.push(voice);
      if (voices.length === MAX_REPORTED_VOICES) break;
    }
    return {
      available: voices.length > 0,
      engine: "Windows System.Speech",
      voices,
      reason:
        voices.length > 0
          ? null
          : "No enabled English or Japanese System.Speech voices with a reported male/female gender were found.",
    };
  } catch {
    return unavailableCapability("Windows System.Speech could not be queried on this device.");
  }
}

export async function synthesizeWindowsCompletionSpeech(
  input: DesktopCompletionSpeechSynthesizeInput,
  dependencies: WindowsCompletionSpeechDependencies = {},
): Promise<DesktopCompletionSpeechSynthesizeResult> {
  if ((dependencies.platform ?? process.platform) !== "win32") {
    return {
      clip: null,
      reason: "Native speech synthesis is available only in the Windows desktop app.",
    };
  }

  // The IPC schema already enforces these enums. Keep a second fail-closed
  // check at the native boundary so no future caller can widen the request.
  if (!isLanguage(input.language) || !isGender(input.gender)) {
    return { clip: null, reason: "Invalid completion speech selection." };
  }

  const makeTempDirectory =
    dependencies.makeTempDirectory ?? (() => mkdtemp(join(tmpdir(), "cafe-code-speech-")));
  const removeTempDirectory =
    dependencies.removeTempDirectory ??
    ((path) => rm(path, { recursive: true, force: true, maxRetries: 2 }));
  const readWav = dependencies.readWav ?? readBoundedWav;
  let directory: string;
  try {
    directory = await makeTempDirectory();
  } catch {
    return { clip: null, reason: "Completion speech storage is unavailable." };
  }
  const wavPath = join(directory, "completion.wav");

  try {
    const raw = await (dependencies.runPowerShell ?? defaultPowerShellRunner)(SYNTHESIZE_SCRIPT, {
      CAFE_CODE_SPEECH_LANGUAGE: input.language,
      CAFE_CODE_SPEECH_GENDER: input.gender,
      CAFE_CODE_SPEECH_OUTPUT: wavPath,
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.unavailable === true) {
      return {
        clip: null,
        reason: `No installed ${input.language === "ja" ? "Japanese" : "English"} ${input.gender} System.Speech voice is available.`,
      };
    }
    const voice = decodeVoice(parsed);
    if (!voice || voice.language !== input.language || voice.gender !== input.gender) {
      return { clip: null, reason: "System.Speech returned invalid voice metadata." };
    }
    const wav = await readWav(wavPath);
    if (wav.byteLength === 0 || wav.byteLength > MAX_WAV_BYTES || !isShortWav(wav)) {
      return {
        clip: null,
        reason: "The synthesized completion phrase was not a safe short WAV.",
      };
    }
    return {
      clip: {
        language: input.language,
        requestedGender: input.gender,
        voice,
        wavBase64: wav.toString("base64"),
      },
      reason: null,
    };
  } catch {
    return { clip: null, reason: "Windows System.Speech could not synthesize this voice." };
  } finally {
    await removeTempDirectory(directory).catch(() => {});
  }
}

export const WINDOWS_COMPLETION_SPEECH_SCRIPTS = {
  listVoices: LIST_VOICES_SCRIPT,
  synthesize: SYNTHESIZE_SCRIPT,
} as const;
