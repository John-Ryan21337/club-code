# World clock panel

An optional, movable multi-city clock that floats over Cafe Code, with an
optional current-weather readout. It is **off by default**: a fresh install
keeps the chrome exactly as it is today, and nothing in this feature performs
network work until the operator turns it on.

- Adoption branch: `adoption/cafe-dev-world-clock-20260911`
- Settings location: **Settings → Appearance group → World Clock**
  (`/settings/world-clock`)

## What it is at runtime

`WorldClockWidget` is mounted once in `apps/web/src/routes/__root.tsx`, next to
`AmbianceLayer`, so it is available on every route of the web UI and of the
Desktop renderer. It renders:

- a fixed, full-viewport overlay at `z-40` with `pointer-events: none` — the
  same band the ambiance canvas uses, so the panel floats above app content but
  below `z-50` dialogs, popovers and toasts, and the overlay itself can never
  swallow a click;
- inside that overlay, one `pointer-events: auto` panel (a `<section>` labelled
  by its own `World clock` heading), which is the only element that takes input.

When `worldClockEnabled` is `false` the component returns `null` before any
overlay node exists.

### Clock cards

One card per selected city (`WorldClockWidget.parts.tsx` → `ClockCard`). Each
card shows the city name, its IANA time zone, the local time, and the local
date. The time string follows the existing `timestampFormat` client setting
(12/24-hour), so the panel does not introduce a second time-format preference.

Time zones come from an explicit catalog in `apps/web/src/worldClock.ts`: every
selectable city binds a contract id to an IANA zone (for example
`tokyo → Asia/Tokyo`), and all formatting goes through `Intl.DateTimeFormat`
with that `timeZone`. Daylight-saving transitions therefore follow the platform
time-zone database rather than a stored offset. The analog face derives
hour/minute/second from the same zone-aware formatter
(`getWorldClockAnalogParts`, `hourCycle: "h23"`), so the hands show the city's
local time and not the host machine's.

Formatter construction is cached per `(zone, format)` key, because the panel
re-formats every visible city once per second.

### Tick and background behaviour

`useVisibleClockTick(active)` runs a one-second interval **only** while the
panel can actually be seen: `active = enabled && documentVisible && !collapsed`.
A hidden document, a disabled panel or a collapsed panel stops the interval
entirely instead of throttling it, so a backgrounded window does no per-second
render work while provider turns stream. On return to visibility the hook
re-reads the clock immediately rather than showing a stale instant for up to a
second.

Document visibility is read through the shared
`subscribeCafeDocumentVisibility` / `readCafeDocumentVisibilitySnapshot`
accessors added to `apps/web/src/documentVisibility.ts`, so the panel uses the
same convention as other renderer surfaces that own timers instead of
registering its own `visibilitychange` listener.

### Clock styles

`worldClockStyle` selects the face: `rainbow` (rainbow shimmer), `nixie` (amber
nixie tubes), `analog` (transparent analog) and `led` (old-school LED). The
styles are CSS in `apps/web/src/index.css`, keyed off the
`cafe-world-clock-<style>` class on the panel element.

Accent colour resolution reuses the existing theme tokens in this order:
ambiance colour → Appearance accent colour → sidebar colour. With none of those
set, the panel inherits `--cafe-sidebar-accent` from the stylesheet. When an
accent resolves, the widget publishes it as `--cafe-world-clock-accent` on the
panel and every style rule follows that variable.

## Cities: 1 to 6

The selection is bounded **at the contract boundary**
(`packages/contracts/src/settings.ts`):

- `WorldClockLocationId` is a closed literal union of 12 cities — Tokyo, Los
  Angeles, New York, London, Paris, Berlin, Seoul, Singapore, Sydney, Honolulu,
  Dubai, São Paulo.
- `WorldClockLocationIds` is an array checked for **minimum 1**, **maximum
  `MAX_WORLD_CLOCK_LOCATIONS` = 6**, and **no duplicates**.
- Default selection: `["tokyo", "los-angeles", "london"]`.

The settings UI enforces the same bounds before it ever calls `updateSettings`:
the checkbox for an unselected city is disabled once six are selected, and the
checkbox for the last remaining city is disabled so the selection cannot be
emptied. A rejected patch therefore cannot reach the settings RPC. The row also
reports `N of 6 selected`.

One weather request covers the whole selection, which is the other reason the
list is bounded: an unbounded list would grow both render cost and request size.

## Layout controls (move, resize, collapse)

Panel geometry is **per-renderer window state**, not an account preference. It
lives in this renderer's local storage under `cafe-code:world-clock-panel:v1`
(`apps/web/src/worldClockPanelGeometry.ts`), never in `ClientSettings`.

| Control           | Pointer                               | Keyboard                                              |
| ----------------- | ------------------------------------- | ----------------------------------------------------- |
| Move              | drag the grip handle in the header    | focus the grip, arrow keys (Shift = smaller step)     |
| Resize            | drag the corner handle (bottom right) | focus the handle, arrow keys (Shift = smaller step)   |
| Collapse / expand | the chevron button in the header      | an ordinary button (`aria-expanded`, `aria-controls`) |

Details that matter in use:

- **Native caption buttons.** Windows desktop placement reserves the current
  window-controls overlay height, including geometry changes. The panel controls
  are marked as non-draggable app content.
- **Clamping.** `clampWorldClockPanelGeometry` runs on every render, not only on
  write, so a corrupted, stale or cross-machine geometry can never place the
  panel where its own controls are off-screen. Minimum size is 280×180 with an
  8px viewport margin, and the minimum yields to the viewport so a narrow phone
  window still gets a fully reachable panel. A collapsed panel is clamped
  against its 44px header height only, so collapsing near the bottom edge does
  not move the panel.
- **Viewport source.** Bounds come from `visualViewport` when available, which
  is the correct box on mobile because it excludes the on-screen keyboard and
  the collapsing browser chrome.
- **Gesture cost.** A drag writes into a ref and coalesces to at most one state
  update per animation frame; the persisted value is written once, at the end of
  the gesture. Pointer listeners live on `window`, so a fast drag that leaves
  the panel keeps tracking, and `blur` ends a gesture whose pointer was released
  outside the window.
- **Focus.** Pointer-down on a handle prevents the default (so dragging never
  selects text) and then focuses the handle explicitly, because the same handle
  is the keyboard control.

## Weather: separate, device-local, default-off consent

The weather readout is a **separate opt-in from the clock**, and it is
deliberately **not** a client setting.

Cafe's ordinary appearance preferences are backend-authoritative: they go
through `server.updateClientSettings` and the backend pushes them to every
renderer attached to that environment. That is right for cosmetic state and
wrong here, because enabling weather causes an **outbound request from the
device running the renderer**, disclosing that device's network address and the
selected city coordinates to a third party. Consent for that belongs to the
person at that device — one browser tab must not be able to switch on
third-party requests from the desktop app, a LAN phone and every other connected
client at once.

So the flag lives only in that renderer's local storage, under
`cafe-code:world-clock-weather-consent:v1`
(`apps/web/src/worldClockWeatherConsent.ts`), default `false`. **The absence
from the `ClientSettings` schema is the enforcement**: there is no field for a
sync path, a persisted settings file, or a future settings export/profile that
iterates the schema to copy. A test asserts that absence.

Consent behaviour:

- Defaults to off; a corrupted stored value **fails closed** (no consent → no
  request).
- Withdrawal removes the record, so a later read fails closed.
- The settings switch writes **first** and only then reports the result; if the
  write cannot persist (quota or permission failure), the switch stays unchanged
  and an inline `role="alert"` message says the consent change could not be
  saved. The user never sees weather reported as on when the consent did not
  persist.
- Subscribers are notified only after a successful write (`useSyncExternalStore`
  over a cached snapshot, so reads do not hit storage on every render).
- Same-origin browser tabs share the local storage area. Storage events update
  every remaining consumer, including when the settings panel has unmounted.
- The weather switch is disabled while the world clock panel itself is off.

### The request itself

`apps/web/src/worldWeather.ts` is only reachable when the local consent is on.

- The endpoint is a fixed compile-time HTTPS constant
  (`https://api.open-meteo.com/v1/forecast`). No setting, provider payload or
  URL can redirect it; HTTP redirects are rejected.
- No credentials, no API key, no referrer. The only outbound data is the fixed
  catalog coordinates of the cities the user picked — those coordinates are
  constants in `worldClock.ts` and never come from geolocation.
- Responses are size-bounded (64 KiB), content-type checked, and parsed field by
  field; errors collapse to a fixed category string, so a hostile or broken
  endpoint cannot put its own text on screen. One diagnostic is logged per
  failure run, carrying only that category.
- Timeout 8s; a success caches for 15 minutes; a failure or stale reading starts
  a 5-minute cooldown, so a broken endpoint cannot become a retry loop. Requests
  for the same selection are coalesced.
- **Four gates must all hold to poll**: the panel is enabled, this renderer
  consented, the document is visible, and the panel is not collapsed. Losing any
  one aborts the in-flight request and clears the view, so a hidden or collapsed
  panel does no network work. The next poll is scheduled from the result, not
  from a fixed timer.
- A selection change invalidates the previous snapshot, so a card can never show
  another city's reading. A refresh of the same selection keeps the previous
  values on screen instead of flashing a loading state.
- Attribution: while weather is on, the panel footer links to Open-Meteo.com
  (CC BY 4.0). The settings row states the privacy and licensing terms,
  including that the keyless Open-Meteo API is for non-commercial use, requires
  attribution, and may retain troubleshooting logs of the address and the
  coordinates for up to 90 days.

Card states: `Loading weather…`, a reading (icon, temperature in °C, condition,
wind in km/h), a `stale` badge plus a header `stale weather` marker when a
cached reading is served after a failure, or `Weather unavailable`.

## Settings surface (as implemented on this branch)

`apps/web/src/components/settings/ClockWeatherSettings.tsx`, reached from
**Settings → World Clock** (a `SettingsSidebarNav` entry with a clock icon,
placed directly after Ambiance; route
`apps/web/src/routes/settings.world-clock.tsx`).

| Row               | Control                                                                                     | Storage                                       |
| ----------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------- |
| World clock panel | switch, `aria-label="Show world clock panel"`                                               | `worldClockEnabled` (synced client setting)   |
| Clock style       | select: Rainbow shimmer / Amber nixie tubes / Transparent analog / Old-school LED           | `worldClockStyle` (synced)                    |
| Cities            | 12 checkboxes, 1 to 6 selected, with an `N of 6 selected` status                            | `worldClockLocationIds` (synced)              |
| Current weather   | switch, `aria-label="Show current weather in world clock"`, disabled while the panel is off | renderer-local consent record, **not** synced |

A reset button appears on the first row whenever any of the three synced clock
values differ from their defaults, and resets all three together. The world
clock is also reported by name in the settings-restore summary
(`SettingsPanels.tsx`) when its values are non-default.

There is intentionally **no** setting for a reactive palette source. Club Code
drives the same accent variable from a live Matrix palette frame store; Cafe has
no equivalent reactive colour source today, so this adoption ships no inert
control for it. If such a store is added later, publishing into
`--cafe-world-clock-accent` is sufficient and no other change is needed.

## Source map

| Path                                                        | Role                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/settings.ts`                        | `WorldClockStyle`, `WorldClockLocationId`, bounded `WorldClockLocationIds`, defaults, schema + patch keys |
| `apps/web/src/worldClock.ts`                                | city catalog, zone-aware formatting, analog parts/angles                                                  |
| `apps/web/src/worldClockPanelGeometry.ts`                   | geometry schema, storage key, clamping                                                                    |
| `apps/web/src/worldClockWeatherConsent.ts`                  | renderer-local consent store                                                                              |
| `apps/web/src/worldWeather.ts`                              | bounded, consent-gated weather client                                                                     |
| `apps/web/src/components/WorldClockWidget.tsx`              | overlay, polling, drag/resize/collapse                                                                    |
| `apps/web/src/components/WorldClockWidget.hooks.ts`         | visibility, viewport bounds, visible-only tick, consent hook                                              |
| `apps/web/src/components/WorldClockWidget.parts.tsx`        | clock card, analog face, weather row                                                                      |
| `apps/web/src/components/settings/ClockWeatherSettings.tsx` | settings section                                                                                          |
| `apps/web/src/routes/settings.world-clock.tsx`              | settings route                                                                                            |
| `apps/web/src/routes/__root.tsx`                            | single mount point                                                                                        |
| `apps/web/src/documentVisibility.ts`                        | shared visibility store accessors                                                                         |
| `apps/web/src/index.css`                                    | the four clock styles                                                                                     |

Tests: `apps/web/src/worldClock.test.ts`,
`apps/web/src/worldClockPanelGeometry.test.ts`,
`apps/web/src/worldClockWeatherConsent.test.ts`,
`apps/web/src/worldWeather.test.ts`,
`packages/contracts/src/settings.worldClock.test.ts`, and the browser tests
`apps/web/src/components/WorldClockWidget.browser.tsx` and
`apps/web/src/components/settings/ClockWeatherSettings.browser.tsx`. Every
browser test injects a fake weather client, so no test can reach a real
endpoint.

## Media

All of it is **synthetic component capture**: isolated renders of the real
component with mocked settings, a mocked clock and an injected fake weather
client — not a screenshot of a running Cafe Code app, a live backend, or the
Desktop build. The backdrop behind the panel is a stand-in drawn by the capture
harness, and every frame is captioned as synthetic. See
[`docs/adoption-media/world-clock/README.md`](adoption-media/world-clock/README.md)
for exactly how they were made.

| File                                                                                      | Shows                                                                       |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`world-clock-before.png`](adoption-media/world-clock/world-clock-before.png)             | setting off — the widget renders nothing                                    |
| [`world-clock-after.png`](adoption-media/world-clock/world-clock-after.png)               | setting on — 4 cities, rainbow style, weather consented, attribution footer |
| [`world-clock-interaction.webm`](adoption-media/world-clock/world-clock-interaction.webm) | move, resize, keyboard nudge, collapse and expand                           |
