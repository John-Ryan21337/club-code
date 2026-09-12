import { accessSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { buildProviderInvocation, resolvePathCommand } from "./provider-access-command.ts";
import {
  resolveWindowsSystemExecutable,
  validatedWindowsSystemRoot,
} from "./windows-system-path.ts";

vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  accessSync: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

it("keeps native arguments literal and wraps only Windows command shims", () => {
  expect(buildProviderInvocation("/opt/claude", ["a b", "$literal"], "linux")).toEqual({
    argv: ["/opt/claude", "a b", "$literal"],
  });
  expect(buildProviderInvocation("C:\\tools\\claude.exe", ["a b"], "win32")).toEqual({
    argv: ["C:\\tools\\claude.exe", "a b"],
  });
  const cmd = "C:\\Windows\\System32\\cmd.exe";
  expect(buildProviderInvocation("C:\\tools\\claude.cmd", ["--tools", ""], "win32", cmd)).toEqual({
    argv: [cmd, "/d", "/v:off", "/s", "/c", '""C:\\tools\\claude.cmd" "--tools" """'],
    windowsVerbatimArguments: true,
  });
  expect(buildProviderInvocation("C:\\tools!literal!\\claude.cmd", ["a&b"], "win32", cmd)).toEqual({
    argv: [cmd, "/d", "/v:off", "/s", "/c", '""C:\\tools!literal!\\claude.cmd" "a&b""'],
    windowsVerbatimArguments: true,
  });
  for (const unsafe of ["%PATH%", 'a"b', "a\nb", "a\rb", "a\0b"]) {
    expect(() =>
      buildProviderInvocation("C:\\tools\\claude.cmd", [unsafe], "win32", cmd),
    ).toThrow();
  }
});

it("resolves PATH using the selected platform and respects executable absence", () => {
  vi.mocked(accessSync).mockImplementation((path) => {
    if (path !== "D:\\bin\\claude.exe" && path !== "/opt/bin/claude") throw new Error("absent");
  });
  expect(
    resolvePathCommand("claude", { PATH: "C:\\missing;D:\\bin", PATHEXT: ".EXE;.CMD" }, "win32"),
  ).toBe("D:\\bin\\claude.exe");
  expect(resolvePathCommand("claude", { PATH: "/missing:/opt/bin" }, "linux")).toBe(
    "/opt/bin/claude",
  );
  expect(resolvePathCommand("missing", { PATH: "/missing" }, "linux")).toBeNull();
});

it("freezes a relative PATH lookup before the subprocess changes cwd", () => {
  const executable = resolve(
    "relative-bin",
    process.platform === "win32" ? "claude.exe" : "claude",
  );
  vi.mocked(accessSync).mockImplementation((path) => {
    if (path !== executable) throw new Error("absent");
  });
  expect(resolvePathCommand("claude", { PATH: "relative-bin", PATHEXT: ".EXE" })).toBe(executable);
});

it("rejects ambiguous system roots and traversal instead of trusting PATH", () => {
  expect(
    resolveWindowsSystemExecutable("taskkill.exe", {
      SystemRoot: "D:\\Windows",
      SystemDrive: "D:",
    }),
  ).toBe("D:\\Windows\\System32\\taskkill.exe");
  for (const env of [
    { SystemRoot: "C:\\Users\\fixture\\Windows" },
    { SystemRoot: "C:\\Windows", systemroot: "D:\\Windows" },
    { SystemRoot: "C:\\Windows", windir: "D:\\Windows" },
    { SystemRoot: "D:\\Windows", SystemDrive: "C:" },
  ])
    expect(() => validatedWindowsSystemRoot(env)).toThrow();
  for (const path of ["../cmd.exe", "C:\\tools\\cmd.exe", "sub/../cmd.exe", ""]) {
    expect(() => resolveWindowsSystemExecutable(path, {})).toThrow();
  }
});
