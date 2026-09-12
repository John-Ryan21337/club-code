# Local player verification media

These images and the recording show the real LocalMediaPanel component. The fixture creates a sine-wave WAV in memory; Chromium launches with audio output muted. It uses real Web Audio analysis and the bundled MilkDrop renderer. The fixture forces its focus predicate to keep headless capture stable and selects the styles through the session store; product Settings exposes those choices. It does not contact user accounts, request microphone/display access, or open user files.

- before.png: selected synthetic file, analysis off.
- spectrum.png: explicit activation, real analyser output and normal playback controls.
- milkdrop.png: bundled preset after navigation, real GPU rendering.
- paused.png: playback paused with guidance; rendering has stopped.
- interaction.webm: unedited 7-second fixture recording, decoded and inspected through the final disabled state.

The fixture verifies a synthetic browser path. Native VLC codecs, desktop audio routing, every preset and every GPU require separate qualification.
