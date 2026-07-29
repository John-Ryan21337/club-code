// @effect-diagnostics nodeBuiltinImport:off

import { execFile, type ChildProcess } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { win32 as pathWin32 } from "node:path";

import {
  MAX_TEMPERATURE_SENSORS,
  type ServerSystemTemperatureTelemetry,
} from "@cafecode/contracts";

import { buildGpuProbeEnvironment, validatedWindowsSystemRoot } from "./GpuProbeProcess.ts";
import {
  parseTemperatureProbeOutput,
  temperatureTelemetryFromRawSamples,
  unavailableTemperatureTelemetry,
} from "./TemperatureTelemetry.ts";

const MAX_PROBE_OUTPUT_BYTES = 16_384;
const TEMPERATURE_PROBE_TIMEOUT_MS = 2_000;
/** Extra time after Node's kill request before the caller is settled regardless. */
const TEMPERATURE_PROBE_FORCE_SETTLE_GRACE_MS = 500;
const WINDOWS_POWERSHELL_SUBPATH = [
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
] as const;
const WINDOWS_TEMPERATURE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$ProgressPreference='SilentlyContinue'",
  "$cimModule=$env:SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\Modules\\CimCmdlets\\CimCmdlets.psd1'",
  "$utilityModule=$env:SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1'",
  "Import-Module $cimModule -ErrorAction Stop",
  "Import-Module $utilityModule -ErrorAction Stop",
  "$sources=@(@{Namespace='root/LibreHardwareMonitor';Source='libre-hardware-monitor'},@{Namespace='root/OpenHardwareMonitor';Source='open-hardware-monitor'})",
  "foreach($candidate in $sources){try{$rows=@();foreach($sensor in @(CimCmdlets\\Get-CimInstance -Namespace $candidate.Namespace -ClassName Sensor -ErrorAction Stop)){if($sensor.SensorType -eq 'Temperature' -and $rows.Count -lt 128){$rows += [PSCustomObject]@{Source=$candidate.Source;Name=$sensor.Name;Identifier=$sensor.Identifier;Value=$sensor.Value}}};if($rows.Count -gt 0){$rows | Microsoft.PowerShell.Utility\\ConvertTo-Json -Compress -Depth 3;exit 0}}catch{}}",
  "'[]'",
].join(";");

const WINDOWS_POWERSHELL_ARGS = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  WINDOWS_TEMPERATURE_SCRIPT,
] as const;

export interface HostTemperatureProbeProcessShape {
  readonly read: () => Promise<ServerSystemTemperatureTelemetry>;
  readonly close: () => Promise<void>;
}

interface HostTemperatureProbeOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly isExecutable?: (path: string) => boolean;
  readonly exec?: typeof execFile;
  readonly readLinux?: () => Promise<ServerSystemTemperatureTelemetry>;
  readonly probeTimeoutMs?: number;
  readonly forceSettleGraceMs?: number;
}

function executableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number) {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 && value <= maximum
    ? value
    : fallback;
}

function requestProbeStop(child: ChildProcess): void {
  try {
    child.kill("SIGKILL");
  } catch {
    // Best effort; the independent settlement deadline remains authoritative.
  }
  try {
    child.stdin?.destroy();
  } catch {
    // Best effort.
  }
  try {
    child.stdout?.destroy();
  } catch {
    // Best effort.
  }
  try {
    child.stderr?.destroy();
  } catch {
    // Best effort.
  }
  try {
    child.unref();
  } catch {
    // Best effort.
  }
}

function scheduleDeadline(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
  const deadline = setTimeout(callback, delayMs);
  deadline.unref();
  return deadline;
}

export function resolveTrustedTemperaturePowerShell(
  env: NodeJS.ProcessEnv,
  isExecutable: (path: string) => boolean = executableFile,
): string | null {
  const systemRoot = validatedWindowsSystemRoot(env);
  if (systemRoot === null) return null;
  const candidate = pathWin32.join(systemRoot, ...WINDOWS_POWERSHELL_SUBPATH);
  return isExecutable(candidate) ? candidate : null;
}

async function readLinuxHwmonTemperatures(): Promise<ServerSystemTemperatureTelemetry> {
  let directories: string[];
  try {
    directories = (await readdir("/sys/class/hwmon"))
      .filter((entry) => /^hwmon\d+$/u.test(entry))
      .toSorted()
      .slice(0, MAX_TEMPERATURE_SENSORS);
  } catch {
    return unavailableTemperatureTelemetry("unsupported");
  }

  const samples: Array<{
    source: "linux-hwmon";
    name: string;
    identifier: string;
    value: number;
  }> = [];
  for (const directory of directories) {
    if (samples.length >= MAX_TEMPERATURE_SENSORS) break;
    const root = `/sys/class/hwmon/${directory}`;
    let driver = directory;
    try {
      driver = (await readFile(`${root}/name`, "utf8")).trim() || directory;
    } catch {
      // A driver label is optional; the fixed hwmon directory remains stable.
    }
    let entries: string[];
    try {
      entries = (await readdir(root)).filter((entry) => /^temp\d+_input$/u.test(entry)).toSorted();
    } catch {
      continue;
    }
    for (const inputName of entries) {
      if (samples.length >= MAX_TEMPERATURE_SENSORS) break;
      const stem = inputName.slice(0, -"_input".length);
      let raw: string;
      try {
        raw = await readFile(`${root}/${inputName}`, "utf8");
      } catch {
        continue;
      }
      const milliCelsius = Number(raw.trim());
      if (!Number.isFinite(milliCelsius)) continue;
      let label = `${driver} ${stem}`;
      try {
        const sensorLabel = (await readFile(`${root}/${stem}_label`, "utf8")).trim();
        if (sensorLabel.length > 0) label = `${driver} ${sensorLabel}`;
      } catch {
        // The kernel does not require a per-channel label.
      }
      samples.push({
        source: "linux-hwmon",
        name: label,
        identifier: `/${driver}/${stem}`,
        value: milliCelsius / 1_000,
      });
    }
  }
  return temperatureTelemetryFromRawSamples(samples);
}

function makeHostTemperatureProbeProcessWithOptions(
  options: HostTemperatureProbeOptions = {},
): HostTemperatureProbeProcessShape {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const execute = options.exec ?? execFile;
  const probeTimeoutMs = boundedPositiveInteger(
    options.probeTimeoutMs,
    TEMPERATURE_PROBE_TIMEOUT_MS,
    10_000,
  );
  const forceSettleGraceMs = boundedPositiveInteger(
    options.forceSettleGraceMs,
    TEMPERATURE_PROBE_FORCE_SETTLE_GRACE_MS,
    10_000,
  );
  let activeWindowsProbe: {
    readonly result: Promise<ServerSystemTemperatureTelemetry>;
    child: ChildProcess | null;
    finish: (result: ServerSystemTemperatureTelemetry) => void;
  } | null = null;
  let closed = false;

  const readWindows = (): Promise<ServerSystemTemperatureTelemetry> => {
    const executable = resolveTrustedTemperaturePowerShell(env, options.isExecutable);
    if (executable === null) {
      return Promise.resolve(unavailableTemperatureTelemetry("unsupported"));
    }
    const systemRoot = validatedWindowsSystemRoot(env);
    if (systemRoot === null) {
      return Promise.resolve(unavailableTemperatureTelemetry("unsupported"));
    }
    if (closed) {
      return Promise.resolve(unavailableTemperatureTelemetry("probe-failed"));
    }
    // Share one logical read and retain its admission slot after a forced
    // settlement until Node actually reports the helper reaped. This bounds a
    // hostile WMI/stdio failure to one OS process instead of spawning another
    // PowerShell helper on every telemetry poll.
    if (activeWindowsProbe !== null) return activeWindowsProbe.result;

    let resolveResult!: (result: ServerSystemTemperatureTelemetry) => void;
    const result = new Promise<ServerSystemTemperatureTelemetry>((resolve) => {
      resolveResult = resolve;
    });
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const record = {
      result,
      child: null as ChildProcess | null,
      finish: (next: ServerSystemTemperatureTelemetry) => {
        if (settled) return;
        settled = true;
        if (deadline !== null) {
          clearTimeout(deadline);
          deadline = null;
        }
        resolveResult(next);
      },
    };
    activeWindowsProbe = record;

    try {
      const child = execute(
        executable,
        WINDOWS_POWERSHELL_ARGS,
        {
          cwd: pathWin32.join(systemRoot, "System32"),
          env: buildGpuProbeEnvironment(env, "win32"),
          windowsHide: true,
          encoding: "utf8",
          timeout: probeTimeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: MAX_PROBE_OUTPUT_BYTES,
          shell: false,
        },
        (error, stdout) => {
          if (activeWindowsProbe === record) activeWindowsProbe = null;
          if (error) {
            record.finish(unavailableTemperatureTelemetry("probe-failed"));
            return;
          }
          record.finish(parseTemperatureProbeOutput(stdout));
        },
      );
      record.child = child;
      // An injected exec implementation can invoke its callback synchronously.
      // In that case the result is already settled and no deadline is needed.
      if (!settled) {
        deadline = scheduleDeadline(() => {
          if (record.child !== null) requestProbeStop(record.child);
          // Do not clear activeWindowsProbe here. The caller must finish, but a
          // helper that Node has not reaped continues to consume the one slot.
          record.finish(unavailableTemperatureTelemetry("probe-failed"));
        }, probeTimeoutMs + forceSettleGraceMs);
      }
    } catch {
      if (activeWindowsProbe === record) activeWindowsProbe = null;
      record.finish(unavailableTemperatureTelemetry("probe-failed"));
    }
    return result;
  };

  const read = () => {
    if (closed) return Promise.resolve(unavailableTemperatureTelemetry("probe-failed"));
    if (platform === "win32") return readWindows();
    if (platform === "linux") return (options.readLinux ?? readLinuxHwmonTemperatures)();
    return Promise.resolve(unavailableTemperatureTelemetry("unsupported"));
  };

  const close = async () => {
    closed = true;
    const record = activeWindowsProbe;
    activeWindowsProbe = null;
    if (record !== null) {
      if (record.child !== null) requestProbeStop(record.child);
      record.finish(unavailableTemperatureTelemetry("probe-failed"));
    }
  };

  return { read, close };
}

export function makeHostTemperatureProbeProcess(): HostTemperatureProbeProcessShape {
  return makeHostTemperatureProbeProcessWithOptions();
}

export function makeHostTemperatureProbeProcessForTest(
  options: HostTemperatureProbeOptions,
): HostTemperatureProbeProcessShape {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Temperature probe test overrides are unavailable.");
  }
  return makeHostTemperatureProbeProcessWithOptions(options);
}

export const TEMPERATURE_PROBE_ARGS: ReadonlyArray<string> = WINDOWS_POWERSHELL_ARGS;
