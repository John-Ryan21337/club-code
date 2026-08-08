// @effect-diagnostics nodeBuiltinImport:off
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const scriptPath = fileURLToPath(new URL("./repair-club-code-shortcuts.ps1", import.meta.url));
const powershellPath = NodePath.join(
  process.env.SystemRoot ?? String.raw`C:\Windows`,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Club Code shortcut repair", () => {
  it.skipIf(process.platform !== "win32")(
    "rewrites only a shortcut already bound to the validated checkout",
    () => {
      const userProfileRoot = execFileSync(
        powershellPath,
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[Environment]::GetFolderPath('UserProfile')",
        ],
        { encoding: "utf8" },
      ).trim();
      const root = mkdtempSync(NodePath.join(userProfileRoot, "club-code-shortcut-test-"));
      temporaryDirectories.push(root);
      const repoRoot = NodePath.join(root, "checkout");
      mkdirSync(repoRoot, { recursive: true });
      writeFileSync(NodePath.join(repoRoot, "package.json"), '{"name":"@cafecode/monorepo"}\n');
      writeFileSync(NodePath.join(repoRoot, "Start-CafeCode.ps1"), "# fixture\n");

      const recognized = NodePath.join(root, "Club Code.lnk");
      const foreign = NodePath.join(root, "Foreign Club Code.lnk");
      const unrelated = NodePath.join(root, "Unrelated.lnk");
      const workingOnly = NodePath.join(root, "Working Only Club Code.lnk");
      const powershellOwned = NodePath.join(root, "PowerShell Owned Club Code.lnk");
      const createScript = [
        "$shell = New-Object -ComObject WScript.Shell",
        `$known = $shell.CreateShortcut('${recognized.replaceAll("'", "''")}')`,
        `$known.TargetPath = '${NodePath.join(repoRoot, "Start-CafeCode.ps1").replaceAll("'", "''")}'`,
        `$known.WorkingDirectory = '${repoRoot.replaceAll("'", "''")}'`,
        "$known.Save()",
        `$foreign = $shell.CreateShortcut('${foreign.replaceAll("'", "''")}')`,
        "$foreign.TargetPath = 'C:\\old\\Start-CafeCode.ps1'",
        "$foreign.WorkingDirectory = 'C:\\old'",
        "$foreign.Save()",
        `$other = $shell.CreateShortcut('${unrelated.replaceAll("'", "''")}')`,
        "$other.TargetPath = 'C:\\Windows\\notepad.exe'",
        "$other.Save()",
        `$workingOnly = $shell.CreateShortcut('${workingOnly.replaceAll("'", "''")}')`,
        "$workingOnly.TargetPath = 'C:\\Windows\\notepad.exe'",
        `$workingOnly.WorkingDirectory = '${repoRoot.replaceAll("'", "''")}'`,
        "$workingOnly.Save()",
        `$powershellOwned = $shell.CreateShortcut('${powershellOwned.replaceAll("'", "''")}')`,
        `$powershellOwned.TargetPath = '${powershellPath.replaceAll("'", "''")}'`,
        `$powershellOwned.Arguments = '-NoProfile -File "${NodePath.join(repoRoot, "Start-CafeCode.ps1").replaceAll("'", "''")}" -Wait'`,
        `$powershellOwned.WorkingDirectory = '${repoRoot.replaceAll("'", "''")}'`,
        "$powershellOwned.Save()",
      ].join("; ");
      execFileSync(powershellPath, ["-NoProfile", "-NonInteractive", "-Command", createScript], {
        stdio: "ignore",
      });

      execFileSync(
        powershellPath,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
          "-RepoRoot",
          repoRoot,
          "-CandidatePaths",
          recognized,
        ],
        { stdio: "ignore" },
      );
      execFileSync(
        powershellPath,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
          "-RepoRoot",
          repoRoot,
          "-CandidatePaths",
          powershellOwned,
        ],
        { stdio: "ignore" },
      );
      execFileSync(
        powershellPath,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
          "-RepoRoot",
          repoRoot,
          "-CandidatePaths",
          workingOnly,
        ],
        { stdio: "ignore" },
      );
      execFileSync(
        powershellPath,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
          "-RepoRoot",
          repoRoot,
          "-CandidatePaths",
          foreign,
        ],
        { stdio: "ignore" },
      );

      const inspectScript = [
        "$shell = New-Object -ComObject WScript.Shell",
        `$known = $shell.CreateShortcut('${recognized.replaceAll("'", "''")}')`,
        `$foreign = $shell.CreateShortcut('${foreign.replaceAll("'", "''")}')`,
        `$other = $shell.CreateShortcut('${unrelated.replaceAll("'", "''")}')`,
        `$workingOnly = $shell.CreateShortcut('${workingOnly.replaceAll("'", "''")}')`,
        `$powershellOwned = $shell.CreateShortcut('${powershellOwned.replaceAll("'", "''")}')`,
        "[PSCustomObject]@{ KnownTarget = $known.TargetPath; KnownArguments = $known.Arguments; KnownWorking = $known.WorkingDirectory; ForeignTarget = $foreign.TargetPath; OtherTarget = $other.TargetPath; WorkingOnlyTarget = $workingOnly.TargetPath; PowershellOwnedArguments = $powershellOwned.Arguments } | ConvertTo-Json -Compress",
      ].join("; ");
      const observed = JSON.parse(
        execFileSync(powershellPath, ["-NoProfile", "-NonInteractive", "-Command", inspectScript], {
          encoding: "utf8",
        }),
      ) as {
        KnownTarget: string;
        KnownArguments: string;
        KnownWorking: string;
        ForeignTarget: string;
        OtherTarget: string;
        WorkingOnlyTarget: string;
        PowershellOwnedArguments: string;
      };
      expect(observed.KnownTarget.toLowerCase()).toBe(powershellPath.toLowerCase());
      expect(observed.KnownArguments).toContain(NodePath.join(repoRoot, "Start-CafeCode.ps1"));
      expect(observed.KnownWorking.toLowerCase()).toBe(repoRoot.toLowerCase());
      expect(observed.ForeignTarget.toLowerCase()).toBe(
        String.raw`C:\old\Start-CafeCode.ps1`.toLowerCase(),
      );
      expect(observed.OtherTarget.toLowerCase()).toBe(
        String.raw`C:\Windows\notepad.exe`.toLowerCase(),
      );
      expect(observed.WorkingOnlyTarget.toLowerCase()).toBe(
        String.raw`C:\Windows\notepad.exe`.toLowerCase(),
      );
      expect(observed.PowershellOwnedArguments).toContain("-NoLogo -NoProfile");
      expect(observed.PowershellOwnedArguments).toContain("-Wait");
    },
  );
});
