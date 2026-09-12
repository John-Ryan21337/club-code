# Synthetic shared-audio fixture

These images and the unedited recording show the actual `AmbientAudioCaptureControl`, `AmbientVideoWorkspace`, shared-stream analyser and Spectrum/MilkDrop renderer. A fixture hosts the controls beside a blank player iframe. It replaces the browser chooser with a generated oscillator stream and uses browser audio mute. The fixture checks real nonzero analyser readings, actual GPU draws, immediate video-track disposal, retained iframe identity and final audio-track stop.

The ordinary browser tests separately exercise the Settings integration and ownership changes. This media is not evidence of a real chooser, audible service capture, system audio, an account, a microphone or another OS. The independent native prerequisite report proves a synthetic Electron frame-track grant and stop only. No real user media was used.

Run `yarn workspace @cafecode/web exec vitest run --config vitest.display-audio-capture.config.ts`. Keep final media after the source review, decode the recording and inspect its last frame before publication. Generated `raw-video` output is temporary and is not part of the PR.
