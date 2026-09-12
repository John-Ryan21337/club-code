# Public YouTube search

This slice adds explicit public video and playlist search to Settings → Streaming player. It depends on the streaming workspace in [Club PR 87](https://github.com/John-Ryan21337/club-code/pull/87), commit `079e775bdf9067fa191c0b593310dd15566ea1ea`. Apply that stack first, then this commit. No account library, OAuth login, audio capture, or visualizer is included.

The server owner must set both environment variables on the Cafe backend process before starting it:

- `CAFE_CODE_YOUTUBE_PUBLIC_DISCOVERY_ENABLED=true`
- `CAFE_CODE_YOUTUBE_PUBLIC_DISCOVERY_API_KEY` with a Google API key for YouTube Data API v3.

The feature is off by default. A key alone does not enable it. Do not place the key in a frontend `VITE_` variable, URL, saved theme, or client settings. This slice does not add a key-entry UI or change an already running server. Backend child processes follow the existing environment inheritance policy; the key is not isolated from other trusted processes that inherit that environment.

Enter search text and press **Search**. This sends the text to Google through the selected Cafe server and uses that server's API quota. Editing the text does not send a request. Text entered for a previous connection is cleared when the next edit or Search detects a replacement connection. **Cancel search**, leaving settings, or changing the environment discards an unfinished result. A replaced connection also prevents old results from changing the player and prevents old quota errors from being shown for the new server.

Press **Load video** or **Load playlist** to stop the current in-memory queue and save the selected service ID through the existing settings path. The existing player controls playback. YouTube may require another press of Play or may refuse an embed. If settings was opened before a chat anchor existed, return to chat to mount the player, as described in the streaming workspace guide. Search does not read account history or automatically play a result.

## Request boundaries

The backend accepts only an authenticated POST to `/api/ambient-media/youtube/search`. The body contains `query` and optional `maxResults`; unknown fields are rejected. Queries are limited to 120 characters and results to 12. The authenticated session supplies the rate-limit identity, not a forwarding header or a client-supplied ID.

The backend allows 12 requests per session and 120 globally per minute, at most four request bodies and four upstream operations concurrently. A request body is limited to 4 KiB and eight seconds. Google fetch plus body read is limited to 64 KiB and eight seconds. The memory cache has 64 entries and a 30-second lifetime. Cached reads still count toward request limits. These limits are process-local and do not coordinate multiple Cafe server processes.

The Google URL is fixed. The key is sent in the `X-Goog-Api-Key` header, with redirects, browser credentials, and referrers disabled. Only bounded canonical IDs, titles, and recognized artwork metadata are decoded. The settings UI displays text and does not fetch result thumbnails. Upstream raw errors and key material are not returned to the renderer. The browser applies a separate 32 KiB response cap and a 20-second deadline across fetch and body read.

The endpoint and search types follow Google's [search.list reference](https://developers.google.com/youtube/v3/docs/search/list); header authentication follows Google's [system parameter reference](https://docs.cloud.google.com/apis/docs/system-parameters). Current quota and key restrictions must be checked in the owner's Google project.

## Verification limits

Service tests use injected upstream responses, including redirects, oversized bodies, stalled reads, cancellation, cache behavior, and admission limits. HTTP tests use real Cafe authentication with a synthetic discovery service. Browser tests use synthetic search results and cover canonical selection, queue stop, narrow layout, and stale-result rejection. No real Google API key or search request was used for this port. The tests do not prove current live-service availability, account access, or playback permission.

Review media and its reproducible opt-in command are in [the capture notes](pr-assets/youtube-discovery/README.md).
