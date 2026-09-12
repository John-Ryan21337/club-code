# YouTube discovery UI harness

The screenshots and interaction video show the real search settings component inside a synthetic shell. Search results and the server connection are mocked. The selected-source line is a capture-only display. No Google request, API key, account, thumbnail download, or media playback is used.

Run from the repository root:

```text
corepack yarn workspace @cafecode/web exec vitest run --config vitest.youtube-discovery-capture.config.ts
```

The explicit capture fixture is excluded from the default browser suite. It writes `before.png`, `results.png`, and `selected.png`; Playwright writes its recording under `raw-video/`. The published `interaction.webm` is that unedited recording. These files demonstrate component layout and controls, not native Electron behavior or live YouTube compatibility.

The row reuses Cafe's existing settings spacing and button dimensions. At a 320-pixel viewport it wraps long titles and keeps selection controls visible; existing control dimensions and readable labels take priority over exact proportional sizing.
