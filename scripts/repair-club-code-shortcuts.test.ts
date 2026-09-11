// @effect-diagnostics nodeBuiltinImport:off
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
const shortcutRepairTestTimeoutMs = process.platform === "win32" ? 90_000 : 15_000;
const execFileAsync = promisify(execFile);

async function runShortcutFixture(fixturePath: string): Promise<string> {
  // One native process avoids repeated PowerShell/COM cold starts under CI load.
  // Its own deadline stays below the test deadline, and stdin is closed so the
  // child cannot wait for terminal input while holding the fixture directory.
  const result = execFileAsync(
    powershellPath,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fixturePath],
    { encoding: "utf8", timeout: 60_000, windowsHide: true, maxBuffer: 64 * 1_024 },
  );
  result.child.stdin?.end();
  return (await result).stdout;
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    const target = NodePath.resolve(directory);
    if (
      NodePath.dirname(target) !== NodePath.resolve(homedir()) ||
      !NodePath.basename(target).startsWith("club-code-shortcut-test-")
    ) {
      throw new Error("Refusing cleanup outside the owned shortcut fixture.");
    }
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

describe("Club Code shortcut repair", () => {
  it.skipIf(process.platform !== "win32")(
    "rewrites only a shortcut already bound to the validated checkout",
    async () => {
      const userProfileRoot = homedir();
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
      const inspectScript = [
        "$shell = New-Object -ComObject WScript.Shell",
        `$known = $shell.CreateShortcut('${recognized.replaceAll("'", "''")}')`,
        `$foreign = $shell.CreateShortcut('${foreign.replaceAll("'", "''")}')`,
        `$other = $shell.CreateShortcut('${unrelated.replaceAll("'", "''")}')`,
        `$workingOnly = $shell.CreateShortcut('${workingOnly.replaceAll("'", "''")}')`,
        `$powershellOwned = $shell.CreateShortcut('${powershellOwned.replaceAll("'", "''")}')`,
        "[PSCustomObject]@{ KnownTarget = $known.TargetPath; KnownArguments = $known.Arguments; KnownWorking = $known.WorkingDirectory; ForeignTarget = $foreign.TargetPath; OtherTarget = $other.TargetPath; WorkingOnlyTarget = $workingOnly.TargetPath; PowershellOwnedArguments = $powershellOwned.Arguments; EncodingProbe = '日本語' } | ConvertTo-Json -Compress",
      ].join("; ");
      const candidateList = [recognized, powershellOwned, workingOnly, foreign, unrelated]
        .map((candidate) => `'${candidate.replaceAll("'", "''")}'`)
        .join(", ");
      const repairInvocation = `& '${scriptPath.replaceAll("'", "''")}' -RepoRoot '${repoRoot.replaceAll("'", "''")}' -CandidatePaths @(${candidateList}) | Out-Null`;
      const fixturePath = NodePath.join(root, "verify-shortcuts.ps1");
      // Windows PowerShell 5 needs a BOM for the fixture and explicit UTF-8 for
      // redirected output; otherwise the JSON probe loses non-ASCII characters.
      writeFileSync(
        fixturePath,
        "\uFEFF" +
          [
            "$ErrorActionPreference = 'Stop'",
            "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
            createScript,
            repairInvocation,
            inspectScript,
          ].join("\n"),
        "utf8",
      );
      const observed = JSON.parse(await runShortcutFixture(fixturePath)) as {
        KnownTarget: string;
        KnownArguments: string;
        KnownWorking: string;
        ForeignTarget: string;
        OtherTarget: string;
        WorkingOnlyTarget: string;
        PowershellOwnedArguments: string;
        EncodingProbe: string;
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
      expect(observed.EncodingProbe).toBe("日本語");
    },
    shortcutRepairTestTimeoutMs,
  );
});
