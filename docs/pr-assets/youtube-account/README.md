# YouTube account UI capture

The capture shows the real settings component with synthetic connection, consent-status, and owned-playlist responses. No Google API key, OAuth grant, system browser, account, thumbnail, or media playback is used. The selected ID line is capture-only instrumentation.

Run from the repository root:

```text
corepack yarn workspace @cafecode/web exec vitest run --config vitest.youtube-account-capture.config.ts
```

The opt-in fixture is outside default browser test patterns. It records explicit Connect, Check connection, Load my playlists, selection, and Disconnect. Stored connection status is not presented as a live access check. Disconnect clears the Cafe session and does not claim to remove Google's saved permission.

Existing settings controls and wrapping rows are reused. Narrow-layout tests use a 320-pixel viewport and long Japanese playlist titles. Readable controls take priority over exact proportional dimensions.
