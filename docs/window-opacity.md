# Whole-window opacity

Cafe Code can make the whole native desktop window translucent. This is a
native Electron capability (`BrowserWindow.setOpacity`). The renderer never
imitates it with CSS, because CSS cannot make the window frame or the desktop
behind the app show through, and a faked value would hide the real native state
that recovery depends on.

## Where the code lives

| Concern                       | File                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| Contract, bounds and defaults | `packages/contracts/src/ipc.ts`                              |
| Persisted preference          | `apps/desktop/src/settings/DesktopAppSettings.ts`            |
| Native capability and runtime | `apps/desktop/src/window/DesktopWindow.ts`                   |
| Trusted IPC methods           | `apps/desktop/src/ipc/methods/windowOpacity.ts`              |
| Preload bridge                | `apps/desktop/src/preload.ts`                                |
| Settings control              | `apps/web/src/components/settings/WindowOpacitySettings.tsx` |

## Behaviour

- **Opaque by default.** `windowOpacityEnabled` is `false` and the stored
  opacity starts at `DEFAULT_DESKTOP_WINDOW_OPACITY`. No window becomes
  translucent until a user turns the setting on.
- **Bounded values only.** The contract accepts a finite number between
  `MIN_DESKTOP_WINDOW_OPACITY` (0.65) and `MAX_DESKTOP_WINDOW_OPACITY` (1).
  Anything else is rejected at the IPC boundary. A stored value outside the
  band, or of the wrong type, is discarded together with the enable flag on
  load, so recovery is always fully opaque. Unrelated desktop settings in the
  same file survive that recovery.
- **Supported platforms only.** `resolveDesktopWindowOpacityCapability` reports
  `unsupported-platform` for every platform other than macOS and Windows.
  Packaged builds additionally report `release-not-validated` until the
  platform is listed in `VALIDATED_RELEASE_OPACITY_PLATFORMS`, which stays
  empty until native smoke evidence is recorded for that artifact. An
  unsupported host keeps the control disabled and states why; it never applies
  or persists an opacity.
- **Persist only after native success.** The preference is written to disk only
  after every live window accepted the new opacity.
- **Roll back on a failed write.** If persistence fails after a successful
  native write, the previous effective opacity is re-applied so the live window
  matches what is actually stored, and the state carries
  `reason: "persistence-failed"`.
- **Reset to opaque on native failure.** If the native write fails, the windows
  are returned to opacity `1` and a safe (disabled, opaque) preference is
  stored; the state carries `reason: "apply-failed"`.
- **Never claim an unverified recovery.** If the reset or rollback itself
  fails, `effectiveOpacity` is `null` and `reason` is `"safe-reset-failed"`, so
  the renderer tells the user to restart instead of showing a safe window.
- **Serialized updates.** Reads, writes and startup application all run under a
  one-permit semaphore, so concurrent renderer requests cannot interleave one
  request's apply with another request's rollback.
- **Applied at window creation and reveal.** A newly created window receives the
  persisted opacity before it is shown, so a translucent preference never
  flashes opaque.

## Renderer behaviour

The settings control reads the native state when it mounts and shows what the
desktop reports. It sends one request per distinct choice (pointer release,
keyboard change, blur and the reset button all collapse to the same request
signature), and it always adopts the state returned by the desktop rather than
assuming the request succeeded. Outside the desktop app the control is disabled
and says that the feature needs the desktop app. If the state cannot be read at
all, the control offers an explicit "Restore opaque window" action.

## Native validation

Automated unit tests mock Electron, so they prove the decision logic and the
calls into `setOpacity`, not the operating-system compositor. Mocked tests are
never evidence about OS behaviour.

### Opt-in native smoke

```
yarn test:native-window-opacity              # 0.65 probe opacity, temp profile
yarn test:native-window-opacity --opacity 0.8 --out <dir>
```

`scripts/window-opacity-native-smoke.ts` launches the installed Electron
runtime (not Cafe Code) with a throwaway `userData` profile and two disposable
windows of its own. It never touches a real Cafe profile, backend, provider or
setting. It checks three things:

1. **The native API.** `BrowserWindow` is constructed with a translucent
   `opacity`, and `getOpacity()` is read before the window is shown, after it is
   shown, after a runtime re-apply, after an opaque reset, and after
   out-of-range writes (Electron clamps `1.5` to `1` and `-1` to `0`).
2. **The compositor.** A solid blue probe window sits over a solid red backdrop
   window. A real screen capture is sampled at the centre of the probe:
   translucent must read the blue/red blend, the opaque reset must read pure
   blue. Two independent capture backends are used — Chromium's
   `desktopCapturer` and a Windows GDI `BitBlt` with `CAPTUREBLT` (a plain
   `BitBlt` drops layered, i.e. translucent, windows).
3. **Whether the host can be observed at all.** Before any window exists the
   probe area is sampled, then sampled again with only the _opaque_ backdrop
   shown. If an opaque window that Electron reports as visible never reaches any
   capture backend, the host session has no observable desktop (headless,
   locked, or a disconnected remote session). The smoke then exits `2` and
   reports `INCONCLUSIVE` instead of claiming either success or a defect.

Exit codes: `0` verified, `1` a real failure, `2` compositor unobservable on
this host.

### Evidence recorded so far

| Date       | Host                                                            | Result                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-11 | Windows 10 Pro 10.0.18363, Electron 42.5.1, development runtime | Native API checks **passed** (`getOpacity` 0.65 before and after show, 1 after reset, clamped 1.5→1 and -1→0). Compositor **INCONCLUSIVE** (exit 2): the host session has no observable desktop. |

On that run both capture backends failed the liveness precondition: Chromium's
`desktopCapturer` returned the same stale wallpaper frame with no windows in it
(DXGI `Duplication failed`), and the GDI capture returned an all-black frame —
including for the fully opaque backdrop window. So that host proves the native
API path, and proves nothing either way about compositing.

### Release gate

`VALIDATED_RELEASE_OPACITY_PLATFORMS` is still **empty**. A development-runtime
smoke is not evidence about a packaged artifact: packaged builds differ in
`app.isPackaged`, window construction, GPU flags and the installed runtime. A
platform may only be added after the _packaged_ Cafe Code artifact for that
platform, launched with its own disposable profile, has been shown to make the
whole window (frame included) translucent and to return to opaque — on a host
where the compositor smoke exits `0`.

## Adoption media

`docs/adoption-media/window-opacity/` holds synthetic component captures of the
settings control: a real `WindowOpacitySettings` render against a synthetic
desktop bridge and a synthetic app shell. The translucency in those frames is a
CSS stand-in for illustration; it is not native-window evidence. See the
[media README](adoption-media/window-opacity/README.md).
