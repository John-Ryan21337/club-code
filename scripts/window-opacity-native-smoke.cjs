const { app, BrowserWindow } = require("electron");

const OUTPUT_PREFIX = "CAFE_CODE_WINDOW_OPACITY_SMOKE=";
const SUPPORTED_PLATFORMS = new Set(["darwin", "win32"]);
const TEST_OPACITY = 0.8;
const TOLERANCE = 0.02;

function closeEnough(left, right) {
  return Number.isFinite(left) && Math.abs(left - right) <= TOLERANCE;
}

function emit(result) {
  console.info(`${OUTPUT_PREFIX}${JSON.stringify(result)}`);
}

async function run() {
  await app.whenReady();
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    return {
      ok: false,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      skipped: true,
      reason: "unsupported-platform",
    };
  }

  const window = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const initial = window.getOpacity();
  window.setOpacity(TEST_OPACITY);
  const changed = window.getOpacity();
  window.setOpacity(1);
  const restored = window.getOpacity();
  return {
    ok: closeEnough(initial, 1) && closeEnough(changed, TEST_OPACITY) && closeEnough(restored, 1),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    skipped: false,
    initial,
    changed,
    restored,
  };
}

run()
  .then((result) => {
    emit(result);
    process.exitCode = result.ok ? 0 : 1;
    // Let Electron close the test window through its normal lifecycle. Forcing
    // BrowserWindow.destroy() immediately before app.exit() can race an in-flight
    // Windows DWM opacity update and intermittently crash the native process.
    app.quit();
  })
  .catch((error) => {
    emit({
      ok: false,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      skipped: false,
      error: error instanceof Error ? error.message : "unknown-error",
    });
    process.exitCode = 1;
    app.quit();
  });
