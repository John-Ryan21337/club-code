# Local media player workspace

This incremental renderer slice combines the [streaming workspace #87](https://github.com/John-Ryan21337/club-code/pull/87) (`079e775b`) and native media runtime (`5b795366`, including the silent-stream repair). Its prerequisite merge is `063db8d5`. Apply both prerequisites before this change. The native runtime itself depends on [sender-bound IPC #75](https://github.com/cafeai/cafe-code/pull/75).

Open Settings → Ambiance → Local Media. Direct queue selects browser-supported files. Open with VLC uses the native picker and the installed decoder. Return to chat to see the player. No file is uploaded. The queue permits 64 files and 64 GiB total. Its titles, object URLs, native tokens and playback options are kept in memory. Clear, refresh, environment changes and workspace teardown release the selection. Switching between chat and settings retains the same player after a chat anchor exists.

Floating playback supports corner presets, mouse movement, resizing and keyboard adjustments. Cinema keeps the player beside chat and reserves the Windows caption band. Escape restores floating mode. Video background uses a bounded opacity behind readable chat surfaces, with separate transport controls. Local cinema or background mode removes the streaming iframe until local presentation ends. Playback does not start automatically on initial selection. After a successfully played item ends, the player makes one attempt to continue the next item. New selections, Clear and workspace teardown cancel late continuation. Queue navigation and bounded error skipping reuse the selected browser/native engine.

The native bridge returns only opaque playback capabilities and bounded display titles. The renderer cannot send a filesystem path. A late native picker result cannot replace a newer selection or a queue cleared during an environment change. The renderer also releases a pending result if its settings owner has unmounted. Leaving settings retains an already selected queue. Direct files stay in the document, and every replaced or cleared object URL is revoked. Native ownership and process isolation are described in [the runtime notes](native-local-media.md).

If the browser rejects an automatic continuation, the player keeps its native controls available for manual Play. The rejection does not become a claim that the file cannot be decoded.

Adaptive video glow samples a small frame locally. Hidden documents stop the sampling timer. Decode failures, unavailable frames and tainted canvases return to the selected fixed color. No frame is uploaded. Audio-only selections use fixed glow.

This slice does not include MilkDrop, audio visualizers, system audio capture, media discovery, service accounts or a persisted media library. Streaming account and embed limits remain in [the streaming notes](streaming-player-workspace.md). Browser fixtures validate real components with generated or placeholder media. The native prerequisite separately verified actual Chromium HTML audio decoding from its owner-bound VLC stream using generated silence. That does not establish support for every codec, video format or operating system.

## Review images

The [floating player](images/local-media/floating-ui-harness.png), [cinema layout](images/local-media/cinema-ui-harness.png), [video background](images/local-media/background-ui-harness.png) and [settings](images/local-media/settings-ui-harness.png) show real components in a UI harness. The video contains generated pixels with an explicit fixture label. These images do not show a personal file or prove native VLC playback inside the renderer.
