# YouTube account connection and owned playlists

This slice adds explicit account connection and owned-playlist selection to Settings > Streaming player. Apply [Club PR 104](https://github.com/John-Ryan21337/club-code/pull/104), commit `f7e6e2e6152b1de71ad58cad0a869ce347b7e3a2`, and its streaming prerequisites first. Public search remains separate. This slice does not add watch history, a complete library, audio capture, or a visualizer.

## Configure the local backend

Use a Google OAuth client for a Desktop application with YouTube Data API v3 enabled. Configure the consent screen and any test users in that Google project. Follow Google's [installed application setup](https://developers.google.com/identity/protocols/oauth2/native-app) for current project requirements. Cafe requests only `https://www.googleapis.com/auth/youtube.readonly`.

Set both variables on the Cafe backend process before starting it:

- `CAFE_CODE_YOUTUBE_ACCOUNT_CONNECTION_ENABLED=true`
- `CAFE_CODE_YOUTUBE_OAUTH_DESKTOP_CLIENT_ID=<your-client-id>.apps.googleusercontent.com`

The feature is off by default. A client ID alone does not enable it. This flow uses a Desktop client ID and PKCE; it does not accept a client secret or the public-search API key. The ID is not a secret. No account tokens are placed in frontend configuration, client settings, files, or the provider environment by this feature.

The API requires an authenticated owner session and a direct loopback peer observed by Cafe. Forwarded or HTTPS-proxy requests and paired client sessions are refused. This is an owner-and-transport restriction, not native-app attestation. Use the local Cafe UI on the same computer as the backend. Remote access and reverse-proxy callback deployment are outside this slice.

## Use the connection

Press **Connect YouTube** to open the system browser. Complete Google's consent flow, close the callback tab, and return to Cafe. Press **Check connection** to read Cafe's saved connection state. This status does not make a live Google request and does not prove the grant is still valid.

Press **Load my playlists** to request the first 50 owned playlists. Cafe refreshes an expiring access token when needed for this request. A failure is shown without raw Google diagnostics. This action can use the project's API quota. The request uses [playlists.list](https://developers.google.com/youtube/v3/docs/playlists/list) with `mine=true`; it does not read watch history or paginate the full account library.

Press **Load owned playlist** to stop the in-memory queue and save that playlist ID through the existing player settings. The player uses its normal embed and playback controls. Account authorization does not grant an embed permission to play private or restricted media. If settings was opened before a chat anchor existed, return to chat to mount the player.

Changing the environment clears displayed private playlist titles. Replacing the connection prevents previous results from changing the player and hides previous private titles when the next render observes the replacement. **Stop waiting** cancels the renderer's wait; a connection or disconnect already accepted by the server can still finish. Check connection before another action.

Tokens and pending authorization state exist only in backend memory and belong to the exact Cafe owner session. A backend restart requires another connection. **Disconnect YouTube** immediately removes that session's local grant and cancels its pending network work. It does not remove Google's saved permission. Remove that permission separately in Google Account settings. Google's [revocation behavior](https://developers.google.com/identity/protocols/oauth2/native-app#tokenrevoke) can invalidate other tokens in the same project, so Cafe does not revoke an old grant during replacement, disconnect, or shutdown.

## Boundaries for reviewers

The system-browser request uses random 32-byte state and verifier values with S256 PKCE. The one-use callback returns to `http://127.0.0.1:<backend-port>` at the origin root. Reserved OAuth query fields are handled before the normal development redirect. Root-query HTTP spans are omitted before tracing starts, including rejected callbacks; ordinary root requests remain traced. The OAuth browser-launch operation also disables tracing so a failed launcher cannot retain its authorization URL in a span. Callback responses contain no code or token and use no-store and no-referrer headers. The pending request expires after ten minutes or the Cafe session expiry, whichever comes first.

The service checks the same owner session before and after each upstream operation. Exact epoch identity prevents a late token exchange or refresh from restoring a disconnected, expired, revoked, or replaced grant. Shutdown aborts all epochs and clears memory. At most 32 session grants or pending connections are held. Browser launch admission allows four starts per session and 16 globally per minute, with at most 64 session rate buckets.

One service operation runs at a time, with a 15-second total deadline. Google fetch plus body read has a ten-second deadline, a 16 KiB token-response cap, and a 128 KiB playlist-response cap. An upstream operation that ignores cancellation retains the actual request slot until it settles; later requests cannot create unlimited replacements. URLs are fixed, redirects are refused, and browser credentials and referrers are omitted. Only bounded playlist IDs, titles, and item counts reach the renderer. The browser uses a separate 64 KiB response cap and 20-second total deadline. Limits and stored state are local to one backend process.

Account actions reject request bodies and query overrides. POST and DELETE require the non-simple JSON content type even though their bodies are empty, so a simple cross-origin form cannot launch the system browser or disconnect an owner. Authentication and these request guards run before service dispatch.

## Verification scope

Service tests use synthetic Google responses, including invalid scopes and token types, callback replay and expiry, oversized and stalled bodies, late responses, owner revocation, and disconnect or shutdown during a request. Real HTTP tests use Cafe authentication with a synthetic account service to exercise owner/paired-client boundaries and the root callback beside development routing. Browser tests use synthetic private playlist titles and cover explicit actions, connection replacement, environment changes, cancellation, selection, and narrow layout.

No real Google account, OAuth grant, API key, consent screen, system-browser login, private playlist, or playback was used to qualify this port. Live Google compatibility and project consent configuration still require an owner-run check. [Capture notes and media](pr-assets/youtube-account/README.md) show the real UI with synthetic responses.
