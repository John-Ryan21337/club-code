# Ambient images

Ambient images let the owner show their own image or GIF as a faint layer over
Cafe's content. ("Behind the app" is the wrong description and was the wrong
implementation: an overlay parked under the opaque app chrome renders correctly
and is invisible. See [Presentation and stacking](#presentation-and-stacking).)
The feature is **off by default** and uses only local user-supplied bytes: there is no
third-party image fetch. The bytes are read back over the app's own configured
Cafe HTTP transport like every other Cafe API call, so this is not a claim that
nothing crosses the network.

## Contracts (`packages/contracts/src/settings.ts`)

| Symbol                         | Meaning                                                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AmbientImageAssetId`          | `sha256-<64 hex>.<gif\|jpg\|jpeg\|png\|webp>` — content-addressed, server-minted                                                                                                          |
| `AmbientImageAsset`            | `{ id, url, mimeType, width, height, sizeBytes }`; a filter requires `url === /api/ambient-media/image/<id>`, the MIME type to match the id extension, and `width * height <= 16_777_216` |
| `AmbientImageCycleAssets`      | at most 24 assets, no duplicate ids                                                                                                                                                       |
| `MAX_AMBIENT_IMAGE_FILE_BYTES` | 10 MiB per image                                                                                                                                                                          |
| `MAX_AMBIENT_IMAGE_DIMENSION`  | 4096 px per side                                                                                                                                                                          |
| `AmbientImageCycleSeconds`     | 3 … 3600 seconds                                                                                                                                                                          |
| `AmbientImagePresentationMode` | `floating` \| `theater`                                                                                                                                                                   |

Client settings keys (all defaulted, all off/empty for existing profiles):
`ambientImageEnabled` (false), `ambientImageAsset` (null),
`ambientImageCycleAssets` (`[]`), `ambientImageCycleEnabled` (false),
`ambientImageCycleSeconds` (20), `ambientImagePresentationMode` (`floating`).

Because the asset record is schema-checked on every settings decode, a tampered
settings document cannot smuggle a foreign URL, a mismatched MIME type or an
oversized image into the renderer.

## Routes (`apps/server/src/ambientMedia/http.ts`)

Every route requires an authenticated session
(`ServerAuth.authenticateHttpRequest`); no route accepts a client path, filename
or remote URL. **Mutation is owner-only**; **reading is any authenticated
session**, matching the sidebar branding asset route. Client settings are one
backend-authoritative document, so a paired non-owner viewer that is told to
render an ambient image has to be able to load it — but it must not be able to
write bytes into the profile or delete them.

| Route                                  | Behavior                                                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/ambient-media/image`        | Owner only. Raw bounded body. Rejects >10 MiB by `content-length` pre-check and again by actual byte length; at most 2 uploads in flight process-wide (429 otherwise). Returns `{ ambientImage }`. |
| `GET /api/ambient-media/image/<id>`    | Any authenticated session. Serves stored bytes with the MIME type derived from the validated id, `private, immutable` caching, `nosniff` and `default-src 'none'; sandbox` CSP.                    |
| `DELETE /api/ambient-media/image/<id>` | Owner only. Refuses (409 `referenced`) while the backend-authoritative client settings still reference the id; otherwise removes the file.                                                         |

The shared browser CORS policy advertises only `GET, POST, OPTIONS`; these routes
append `DELETE` to their own `access-control-allow-methods` rather than widening
the allowance for every other browser API route.

The upload admission slot is taken with `Effect.acquireRelease`, not an
increment plus `ensuring`: a slot leaked on interruption would never come back
and capacity would decay until every upload 429s.

Error responses use a closed code vocabulary (`invalid-id`, `invalid-image`,
`not-found`, `storage-failed`, `too-large`, `unsupported-type`, `busy`,
`referenced`) with messages authored in the route — no filesystem path, header
value or uploaded byte is echoed back.

## Trust boundaries

- **No third-party image fetch.** Every ambient asset is bytes the user supplied
  locally, stored by Cafe and read back over the app's own configured Cafe HTTP
  transport. Nothing is fetched from a third-party origin, and no remote URL can
  reach the renderer (the schema pins `url` to the ambient-media route). This is
  deliberately _not_ a "never touches the network" claim: the asset does travel
  over the configured Cafe HTTP endpoint like every other Cafe API call, which
  for a remote/paired client is a real network hop to that Cafe server.
- **Storage is owned by Cafe.** Bytes land in `<stateDir>/ambient-media/images`
  only. The filename is the SHA-256 content hash plus an extension derived from
  the _parsed_ header, so a client can never influence the path. Writes go to a
  scoped temp directory inside that folder and are renamed into place.
- **Content is validated before it is stored, not by the browser.**
  `AmbientImageStore` parses PNG (including CRC and `acTL` rejection), JPEG,
  WebP and GIF headers itself. GIFs are walked block by block and rejected if
  they are truncated, exceed 240 frames, 64 MP cumulative decoded pixels or 120
  seconds of declared delay. A declared `content-type` that disagrees with the
  parsed header is a 415.
- **Profile quota.** At most 256 stored assets and 160 MiB in the profile
  directory; a mutation semaphore serializes store/remove so the quota check and
  the write cannot interleave.
- **Folder picking is an explicit, one-shot user choice.** The settings UI uses a
  `webkitdirectory` file input: the browser returns only the files the user
  picked, Cafe keeps no handle, path or watcher, and `webkitRelativePath` is read
  solely to sort the selection before upload — it is never persisted, logged or
  displayed. `prepareAmbientImageDirectory` bounds the selection at 128 scanned
  entries, 24 uploadable images, 10 MiB each and 80 MiB total, and accepts only
  PNG/JPEG/GIF/WebP.
- **Rendering is inert.** `AmbientImageLayer` renders one `<img>` pointed at the
  authenticated Cafe route — no SVG, no remote origin, no `object-url` lifetime
  to leak, no canvas or video re-encode. GIF animation is left to the browser,
  whose work was bounded at upload time. The layer is `pointer-events-none`,
  `aria-hidden`, and returns `null` whenever the feature is disabled or no asset
  is selected.
- **Deletion is reference-checked server-side at request time.** The DELETE
  route reads the backend-authoritative settings document when the request
  arrives and refuses (409) while that document still references the id, so a
  renderer cannot talk the server into dropping bytes the saved settings point
  at. That check is a snapshot taken before the unlink, not a transaction
  serialized against later settings writes: if a settings mutation reintroduces
  a reference in the window between the check and the unlink, this guard does
  not promise the bytes survive. The renderer never relies on that window — it
  drops the reference with a confirmed write _first_ and only then deletes.

## Presentation and stacking

In plain terms: the image is painted **over** the app as a faint wash, not
behind it. The app shell paints opaque chrome (`bg-card` sidebar, themed content
surfaces), so an overlay parked underneath it renders correctly and is still
completely invisible. The layer therefore sits **above** app content at `z-30` — below the
ambiance canvas (`z-40`) and well below dialogs, popovers and toasts (`z-50`+),
so modal work is never obscured — and is `pointer-events-none`, so every control
underneath stays clickable.

Readability is protected by bounding opacity rather than by hiding the layer:

- **theater** — full-bleed `object-cover` at opacity `0.22`, a faint wash.
- **floating** — a bordered corner panel (max `28vh` × `26vw`) at opacity `0.80`.

If the feature is on and no image has been explicitly selected, the first
library entry is shown, so an upload is visible without a second click.

## Settings mutation sequencing

Every mutation that moves bytes uses a **confirmed** settings write: the section
awaits `server.updateClientSettings`, applies the returned document, and only
then acts. It does not use the fire-and-forget `useUpdateSettings` path for
these, because that path patches local state optimistically and reports the RPC
failure only through the shared settings-write error reporter.

- **Deletion** needs the confirmation because the server refuses to remove bytes
  the settings document still references; a fire-and-forget patch would race the
  guard and lose.
- **Adding files** needs it because uploading writes bytes before anything
  references them. If the save is not awaited, a failed write leaves the UI
  showing new thumbnails and no error while the profile holds bytes nothing
  points at — the exact orphans the prune below exists to avoid. On a failed
  save the section now deletes the ids it just uploaded (only the genuinely new
  ones; a re-upload of an image already in the library is still referenced) and
  reports whether they went, so the failure is never silent in either direction.

Library controls that move no bytes — the on/off switch, selecting a thumbnail,
cycling, seconds, presentation — stay on the ordinary optimistic
`updateSettings` path.

Both removal and folder replacement then run a bounded best-effort prune of the
ids the saved document no longer references (at most
`MAX_AMBIENT_IMAGE_CYCLE_ASSETS` per call). Repeatedly switching folders
therefore cannot walk the profile up to its 160 MiB storage quota. Failures are
counted and surfaced, not thrown: the new library is already saved and correct,
and the server-side reference guard remains the only thing that decides whether
bytes may go. A removal whose file could not be deleted says so
("Removed from the library, but its file is still stored on the server")
instead of dropping the count on the floor and looking clean.

## Adoption order

1. `packages/contracts/src/settings.ts` — asset/cycle schema, limits, six client
   settings keys **in both `ClientSettingsSchema` and `ClientSettingsPatch`**
   (this is the only change other slices depend on).
2. `apps/server/src/ambientMedia/AmbientImageStore.ts` (+ tests) — validation and
   content-addressed storage.
3. `apps/server/src/ambientMedia/http.ts` + `apps/server/src/server.ts` wiring —
   authenticated upload/serve/delete route layers and `AmbientImageStoreLive`.
   `AmbientImageStoreLive` must also be provided to the `server.test.ts` app
   layer, or the whole server test suite stops typechecking.
4. `apps/web/src/ambientImages.ts`, `apps/web/src/ambientImageCycle.ts` (+ tests)
   — client transport and bounded directory preparation.
5. `apps/web/src/ambient/AmbientImageLayer.tsx` + `routes/__root.tsx` — renderer
   presentation and rotation.
6. `apps/web/src/components/settings/AmbientImageSettings.tsx` mounted inside the
   existing Ambiance settings page — upload, library, folder picker, removal,
   cycling and presentation controls.

## Tested behavior

`apps/server/src/ambientMedia/AmbientImageStore.test.ts` (4 tests): valid GIF and
PNG round-trips with dedup by content hash; rejection of forged/corrupt headers,
animated PNG, truncated PNG, bad PNG CRC, header-only JPEG, incomplete WebP and
GIF duration/frame bombs; oversized-file and profile-quota rejection.

`apps/server/src/server.test.ts` (6 tests, real HTTP through
`NodeHttpServer.layerTest` against the actual route layers): upload → serve →
delete → 404 round trip with header assertions (`nosniff`, immutable private
cache, `DELETE` in the advertised methods); the 409 reference guard, proven by
seeding a `ServerClientSettingsService` whose document references the id and
then confirming the bytes are still served; 401 on all three routes without a
session; the `content-length` 413 bound, the 415 declared-type mismatch, the 400
invalid-bytes case and 404 for `..%2f` and nested-path ids; a regression that
five _sequential_ uploads (four rejected, then one accepted) all get an
admission slot, which proves the slot is released on both outcomes but says
nothing about simultaneous load; and a simultaneous-cap test that holds two
uploads open with chunked bodies that never finish, polls until a third upload
is answered `429`, then interrupts one held request and polls until an upload is
admitted again — so both the cap and release-on-cancellation are observed, not
inferred.

> The 413 test sends a real >10 MiB body: the HTTP client recomputes
> `content-length` from the body, so a spoofed header alone proves nothing.
> Note also that `tinyPngBytes` in `server.test.ts` is a lenient branding fixture
> whose IDAT CRC does not check out; ambient tests use their own byte-exact PNG
> because the ambient parser verifies every chunk CRC.

`apps/web/src/components/ambient/AmbientImageLayer.browser.tsx` (7 tests, real
Chromium; the file lives under `src/components/` because
`vitest.browser.config.ts` only globs `src/components/**/*.browser.tsx`): nothing renders for a default profile or with the feature off;
the theater overlay wins paint order against an opaque full-viewport app shell
rendered after it, covers the viewport, keeps opacity ≤ 0.35, and leaves a button
underneath hit-testable; the floating panel is a visible corner panel under half
the viewport width; an unselected library image is shown; a GIF stays a plain
`<img>` with no canvas or video substitute; and the rotation advances and clears
its interval on unmount.

> Paint order is asserted by momentarily setting `pointer-events: auto` on the
> layer and hit-testing, because `elementFromPoint` honours `pointer-events` —
> the real `pointer-events: none` is asserted separately, in the same test.

`apps/web/src/components/settings/AmbientImageSettings.browser.tsx` (6 tests,
real Chromium, real component): synthetic `File` objects are pushed into the
hidden inputs with a `DataTransfer` plus a `change` event (file input) and a
defined `files` list carrying `webkitRelativePath` (folder input) — no OS picker
and no user file — against a fake backend whose DELETE handler re-reads its own
settings document and answers 409 for a still-referenced id. Uploads, the
settings write and the deletes are asserted **in call order**: a two-file
selection uploads both, then saves once, then reports "Added 2 images"; a
rejected save reports the failure, deletes the just-uploaded bytes and leaves no
thumbnail and no success notice; a rejected save whose cleanup also fails says
the bytes are still stored; a folder selection uploads the sorted supported
files, saves, and only _then_ deletes the replaced id; a removal saves the
dropped reference before deleting and keeps the warning when the file survives;
and a removal whose save fails issues no delete at all.

`apps/web/src/ambientImageCycle.test.ts` (2 tests): directory preparation sorts
deterministically, skips unsupported files, and rejects selections that exceed
the entry, count or aggregate-byte bounds.

`docs/pr-assets/ambient-images/` holds before/after stills and an interaction
video of the real components over a mock app shell, captured by
`apps/web/vitest.ambient-image-capture.config.ts` +
`apps/web/src/components/ambient/ambientImageMedia.capture.tsx`. That capture is
media, not coverage: it is off the test path and asserts nothing.

## Honest limitations

- **Orphaned bytes are still possible, and nothing rediscovers them.** Pruning
  is best-effort and scoped to the ids one mutation replaces, and it only runs
  while the renderer is alive to run it. Bytes are left behind if Cafe or the
  tab dies between an upload and its settings write, or between a settings write
  and the follow-up DELETE, or if the DELETE fails for a reason a retry would
  not fix. Nothing sweeps them later, so they occupy the profile's 256-asset /
  160 MiB quota until a mutation happens to replace them — and once that quota
  is reached, further uploads are refused. The failure paths now _report_ the
  situation instead of hiding it, which is not the same as fixing it. The
  upstream store had a bounded startup sweep; it is deliberately not ported
  here, because nothing in Cafe currently calls it and wiring it is a separate
  slice with its own safety argument (it must key off the settings document and
  must not race an in-flight upload). **Follow-up: startup orphan sweep.**
- **No renderer panel chrome.** Upstream's `AmbientImagePanel` (drag/resize,
  glow, preset placement, layout modes) is not ported; presentation is limited to
  the two modes above. The corresponding glow/layout settings keys were left out
  rather than shipped as inert controls.
- **Upload is sequential** in the settings UI (one request at a time), so a
  24-image folder takes 24 round trips. The server bound is 2 concurrent uploads.
- **The folder path is exercised with a synthesized directory selection.** The
  browser test defines `files`/`webkitRelativePath` on the input rather than
  opening an OS directory picker, which no headless browser can do. Everything
  after that point — bounding, sorting, upload, replacement, prune — is the real
  code path, but the browser's own directory enumeration is not covered.
- **A streamed body with no `content-length`** is capped by
  `HttpIncomingMessage.MaxBodySize` at 10 MiB, but surfaces as `400
invalid-image` rather than `413 too-large`. The bound holds; only the status
  code is imprecise.

## Interop with the media-player prerequisites branch

`origin/adoption/media-player-prerequisites-20260911` at `9cbc7c30` carries the
same `AmbientImageAsset` / `AmbientImageCycleAssets` / `AmbientImageCycleSeconds`
/ `AmbientImagePresentationMode` contracts and lists the same six keys in
`ClientSettingsPatch`, plus six of its own (`ambientImageLayoutMode`,
`ambientImagePresetPlacement`, `ambientImagePresetSize`, `ambientImageGlowEnabled`,
`ambientImageGlowColor`, `ambientImageGlowOpacity`). This branch is a strict
subset of that key set, so the two are compatible: merging that branch adds keys
rather than changing the ones here. That branch also owns
`apps/web/src/settingsProfiles.ts`, which does not exist on current dev; when the
two meet, the ambient keys will need profile classifications there. Nothing in
this PR mutates that branch.
