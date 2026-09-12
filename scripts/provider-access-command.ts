import { accessSync, constants } from "node:fs";
import * as NodePath from "node:path";
import { resolveWindowsSystemExecutable } from "./windows-system-path.ts";
export interface CommandInvocation {
  readonly argv: ReadonlyArray<string>;
  readonly windowsVerbatimArguments?: boolean;
}
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolvePathCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const extensions =
    platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  const path = platform === "win32" ? NodePath.win32 : NodePath.posix;
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    // Resolve in the caller's cwd before the probe moves to an empty temporary cwd.
    const directoryPath = path.resolve(directory);
    for (const extension of extensions) {
      const candidate = path.join(directoryPath, `${command}${extension.toLowerCase()}`);
      if (isExecutable(candidate)) return candidate;
      const originalCaseCandidate = path.join(directoryPath, `${command}${extension}`);
      if (originalCaseCandidate !== candidate && isExecutable(originalCaseCandidate)) {
        return originalCaseCandidate;
      }
    }
  }
  return null;
}

export function resolveWindowsCmd(env: NodeJS.ProcessEnv = process.env): string {
  const cmd = resolveWindowsSystemExecutable("cmd.exe", env);
  if (!isExecutable(cmd)) throw new Error("Trusted Windows cmd.exe was not found.");
  return cmd;
}

export function buildProviderInvocation(
  binaryPath: string,
  args: ReadonlyArray<string>,
  platform: NodeJS.Platform = process.platform,
  windowsCmdPath?: string,
): CommandInvocation {
  const extension = NodePath.extname(binaryPath).toLowerCase();
  if (platform !== "win32" || (extension !== ".cmd" && extension !== ".bat")) {
    return { argv: [binaryPath, ...args] };
  }
  if ([binaryPath, ...args].some((value) => value.includes("\u0000") || /[%\r\n"]/u.test(value))) {
    throw new Error("Provider shim path or arguments cannot be represented safely for cmd.exe.");
  }
  const commandLine = `""${binaryPath}" ${args.map((arg) => `"${arg}"`).join(" ")}"`;
  return {
    argv: [windowsCmdPath ?? resolveWindowsCmd(), "/d", "/v:off", "/s", "/c", commandLine],
    windowsVerbatimArguments: true,
  };
}
