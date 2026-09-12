// Opt-in native check. Uses only an owned window, temp profile and silent synthetic audio.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, copyFile, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import ts from "typescript";
const require = createRequire(import.meta.url);
const dir = await mkdtemp(join(tmpdir(), "cafe-frame-audio-verified-"));
const source = await readFile(
  new URL("../src/window/DesktopDisplayMediaCapture.ts", import.meta.url),
  "utf8",
);
await writeFile(
  join(dir, "policy.cjs"),
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
await copyFile(
  new URL("./fixtures/display-frame-audio-smoke.cjs", import.meta.url),
  join(dir, "main.cjs"),
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|LOCALAPPDATA|APPDATA|USERPROFILE|COMSPEC)$/i.test(key),
  ),
);
const log = await open(join(dir, "electron.log"), "w");
let timedOut = false;
const child = spawn(require("electron"), [join(dir, "main.cjs")], {
  cwd: dir,
  env,
  windowsHide: true,
  stdio: ["ignore", log.fd, log.fd],
});
const timer = setTimeout(() => {
  timedOut = true;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else child.kill("SIGKILL");
}, 45000);
let code;
try {
  code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
} finally {
  clearTimeout(timer);
  await log.close();
}
assert.equal(timedOut, false, "Native probe deadline exceeded; see owned temporary report.");
const report = JSON.parse(await readFile(join(dir, "report.json"), "utf8"));
assert.equal(code, 0, "Native capture probe failed; see owned temporary report.");
for (const key of [
  "syntheticOnly",
  "focused",
  "streamAudio",
  "streamVideo",
  "videoStopped",
  "audioStopped",
])
  assert.equal(report[key], true, key);
assert.equal(report.visible, "visible");
assert.equal(report.systemLoopback, false);
assert.equal(report.nativePicker, false);
console.log(
  JSON.stringify({
    ...report,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    electron: require("electron/package.json").version,
    output: dir,
  }),
);
