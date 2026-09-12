const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const { installTrustedFrameAudioCapture } = require("./policy.cjs");
app.setPath("userData", __dirname + "/profile");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
let window, server, cleanup;
let settled = false;
const report = { syntheticOnly: true, nativePicker: false, systemLoopback: false };
async function finish(extra) {
  if (settled) return;
  settled = true;
  Object.assign(report, extra);
  try {
    cleanup?.();
    if (window && !window.isDestroyed()) window.destroy();
    server?.close();
    fs.writeFileSync(__dirname + "/report.json", JSON.stringify(report, null, 2));
  } finally {
    app.exit(report.streamAudio === true ? 0 : 1);
  }
}
setTimeout(() => finish({ deadline: true }), 30000);
app
  .whenReady()
  .then(async () => {
    const html =
      '<!doctype html><meta charset="utf-8"><button style="width:200px;height:80px" id="go">Synthetic current-frame capture</button><script>document.querySelector("button").onclick=async()=>{try{const a=new AudioContext(),o=a.createOscillator(),g=a.createGain();g.gain.value=0;o.connect(g).connect(a.destination);o.start();const pending=navigator.mediaDevices.getDisplayMedia({video:true,audio:true});await a.resume();const s=await pending;const result={streamAudio:s.getAudioTracks().length>0,streamVideo:s.getVideoTracks().length>0,videoStopped:false,audioStopped:false};s.getVideoTracks().forEach(t=>t.stop());result.videoStopped=s.getVideoTracks().every(t=>t.readyState==="ended");s.getAudioTracks().forEach(t=>t.stop());result.audioStopped=s.getAudioTracks().every(t=>t.readyState==="ended");o.stop();await a.close();window.result=result;}catch(e){window.result={errorName:e.name};}}</script>';
    server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const origin = "http://127.0.0.1:" + server.address().port;
    window = new BrowserWindow({
      width: 500,
      height: 300,
      x: -10000,
      y: -10000,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.webContents.setAudioMuted(true);
    cleanup = installTrustedFrameAudioCapture(window.webContents, origin);
    await window.loadURL(origin);
    window.show();
    window.focus();
    await new Promise((r) => setTimeout(r, 300));
    report.visible = window.webContents.mainFrame.visibilityState;
    report.focused = window.webContents.isFocused();
    window.webContents.sendInputEvent({
      type: "mouseDown",
      x: 70,
      y: 45,
      button: "left",
      clickCount: 1,
    });
    window.webContents.sendInputEvent({
      type: "mouseUp",
      x: 70,
      y: 45,
      button: "left",
      clickCount: 1,
    });
    const timer = setInterval(async () => {
      try {
        const result = await window.webContents.executeJavaScript("window.result");
        if (result) {
          clearInterval(timer);
          await finish(result);
        }
      } catch {
        clearInterval(timer);
        await finish({ rendererFailure: true });
      }
    }, 100);
  })
  .catch(() => finish({ mainFailure: true }));
