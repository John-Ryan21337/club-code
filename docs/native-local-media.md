# Native local-media runtime

This incremental prerequisite adds the desktop runtime and strict bridge contracts for a local-media player. It is based on current Cafe `dev` plus [sender-bound IPC #75](https://github.com/cafeai/cafe-code/pull/75), commit `cadc2e7f`. A separate renderer slice supplies the settings and playback controls. This PR alone does not add a player button to Cafe.

## Native boundary

The trusted renderer can check VLC availability, open the native file picker, navigate its current queue, and release its session. It cannot submit a filesystem path. The picker accepts at most 64 supported audio/video files with a total size of 64 GiB. Native checks reject final-component symlinks and non-regular files. These checks do not provide an atomic filesystem snapshot against later changes by another local process.

Selections return a bounded display title, queue position and opaque session/playback tokens. Source paths and loopback stream capabilities stay out of renderer results, settings, logs and process arguments. Each queue belongs to its exact live IPC owner. Unknown tokens, other windows, released sessions and destroyed owners cannot use the playback protocol.

VLC runs as a separate process with a small environment allowlist, a private launch working directory and no shell. The app uses an absolute configured VLC path or fixed OS install locations; it does not scan PATH or the registry or install VLC. Private launch files contain the selected source and output configuration where needed. The app removes them after startup or retries their owned cleanup after process exit.

At most two active or unreaped VLC children can exist in this service. A child that ignores termination continues to occupy its slot. Each item permits at most four response streams. Request cancellation, queue replacement, owner destruction and app shutdown cancel the owned upstream requests and stop the child. Upstream requests omit credentials and do not follow redirects. The protocol forwards only the required media/range headers and disables caching.

Register the `cafecode-media` protocol before renderer navigation, as the startup integration does. Its request authorization uses the default session's single `onBeforeRequest` listener. A future default-session request filter must share that dispatcher; installing a second listener would replace this boundary. Isolated Agent Browser tabs use separate sessions.

## Playback format and platform scope

Audio is transcoded to Ogg/Vorbis; video is transcoded to WebM/VP8 with Vorbis audio. Both profiles use stereo audio at 48 kHz. This resamples or downmixes the input. It prevents the fixed Vorbis bitrate from failing for low-rate recordings, which was reproduced with an 8 kHz mono WAV. VLC's [managed Vorbis setup](https://github.com/videolan/vlc/blob/3.0.12/modules/codec/vorbis.c#L764-L773) validates the input rate and selected bitrate together.

On Windows, the validated VLC 3.0.12 executable does not consume redirected RC stdin. The runtime therefore passes only an opaque private XSPF launch-file path on argv. POSIX uses the encoded source URL on RC stdin and retains its own install locations. A 32-bit VLC executable can run beside 64-bit Electron because this integration loads no VLC DLL into Electron.

The real Windows check used an isolated Electron profile, a native VLC child and generated WAV data. It verified actual Ogg response bytes, wrong-owner read/release denial, token revocation, source-path privacy, child exit and launch-file cleanup. The initial 8 kHz input returned an empty body; the explicit output profile repaired it. A clean rerun passed all 11 checks. No personal media, account or live application session was used. Native playback on macOS/Linux and the later renderer controls remain separate validation steps; unit tests cover their path and launch policy without claiming a live OS probe.
