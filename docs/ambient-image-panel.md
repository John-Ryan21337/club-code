# Ambient image panel

This document records the ambient image panel adoption: what was ported from
Club Code, what the controls do, what the limits are, and what evidence exists.

The previous slice (`6869f0bf`, including the reviewed base repair) added the ambient image library, the upload and
storage path, and an inert overlay. This slice makes the overlay adjustable.

Floating controls reserve the visible native caption band and follow overlay geometry changes. Ordinary browser clients and platforms without that band keep zero inset. Extreme images retain their proportions inside a bounded frame so the four controls remain separate. Geometry records over 4 KiB are discarded before JSON parsing. Blur, pane changes and unmount release active pointer capture.

## Adoption order

Adopt the changes in this order. Each step compiles and passes its own tests.

1. **Contracts.** `packages/contracts/src/settings.ts` adds six presentation
   keys. Add each key to `ClientSettingsSchema` **and** to `ClientSettingsPatch`.
   `ClientSettingsPatch` is the wire payload for `server.updateClientSettings`,
   so a key that is missing there is dropped before persistence and the control
   looks inert.
2. **Geometry storage.** `apps/web/src/ambientImageGeometry.ts`. Per-device
   position and size, with a versioned envelope and a clamp on every read.
3. **Layout math.** `apps/web/src/ambientImagePanelLayout.ts`. No React and no
   DOM, so the bounds are directly testable.
4. **Panel.** `apps/web/src/ambient/AmbientImagePanel.tsx`.
5. **Layer.** `apps/web/src/ambient/AmbientImageLayer.tsx` selects the theater
   wash or the floating panel.
6. **Settings.** `apps/web/src/components/settings/AmbientImagePanelSettings.tsx`,
   rendered by the existing `AmbientImageSettingsSection`.
7. **Tests**, then the opt-in media capture.

## Settings keys

### The exact parent state at `5ad7258e`

The parent runtime had exactly six ambient image keys before this slice:

| Key                            | Role         |
| ------------------------------ | ------------ |
| `ambientImageEnabled`          | activation   |
| `ambientImageAsset`            | library      |
| `ambientImageCycleAssets`      | library      |
| `ambientImageCycleEnabled`     | activation   |
| `ambientImageCycleSeconds`     | presentation |
| `ambientImagePresentationMode` | presentation |

Do not assume that a Club Code contract fits this runtime because both count six
keys. The Club contract additionally carries ambient **video** keys, a shared
`AmbientColor` and `AmbientOpacity` schema, and a named-profile key list. None of
those exist here. This slice ports the image keys only and defines its own
narrow glow schemas instead of copying the shared ambient settings block.

### The six keys this slice adds

| Key                           | Type                           | Default        |
| ----------------------------- | ------------------------------ | -------------- |
| `ambientImageLayoutMode`      | `preset` \| `custom`           | `preset`       |
| `ambientImagePresetPlacement` | one of four corners            | `bottom-right` |
| `ambientImagePresetSize`      | `small` \| `medium` \| `large` | `medium`       |
| `ambientImageGlowEnabled`     | boolean                        | `false`        |
| `ambientImageGlowColor`       | `auto` or `#rrggbb`            | `auto`         |
| `ambientImageGlowOpacity`     | 0.05 to 1                      | `0.35`         |

`ambientImageEnabled` stays `false` by default. Image selection and storage are
unchanged: this slice adds no upload, delete or library behavior.

### Presentation fields against activation fields

This base has no named ambient profile. A later profile slice must keep the
split below. It is recorded here so the profile work does not have to guess.

- **Presentation** — safe for a named profile to carry and to restore:
  `ambientImagePresentationMode`, `ambientImageCycleSeconds`,
  `ambientImageLayoutMode`, `ambientImagePresetPlacement`,
  `ambientImagePresetSize`, `ambientImageGlowEnabled`, `ambientImageGlowColor`,
  `ambientImageGlowOpacity`.
- **Activation** — a profile must not turn these on for the user:
  `ambientImageEnabled`, `ambientImageCycleEnabled`.
- **Library** — a profile must not carry these. They reference stored bytes with
  a server-side quota and a reference guard:
  `ambientImageAsset`, `ambientImageCycleAssets`.
- **Per-device** — never in a profile and never in `ClientSettings`: the custom
  panel geometry in browser storage.

## Behavior

### Controls

| Control                      | Effect                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| Move handle (top left)       | Drag moves the panel. Arrow keys move it in 2% steps. `Home` restores the preset position.       |
| Resize handle (bottom right) | Drag changes the width. Arrow keys change it in 2.5% steps. `Home` restores the preset position. |
| Reset control (bottom left)  | Forgets the stored position and returns the layout to `preset`.                                  |
| Hide control (top right)     | Sets `ambientImageEnabled` to `false`.                                                           |
| Layout                       | `preset` or `custom`.                                                                            |
| Preset corner, Preset size   | Repaint the preset rectangle at once.                                                            |
| Panel glow, color, intensity | Change the panel shadow at once.                                                                 |

A drag or an arrow key press promotes the layout from `preset` to `custom`.
Without this promotion the panel would return to its corner on the next render,
and the handle would be an inert control.

### Stacking

The layer is `fixed inset-0 z-30` and `pointer-events-none`. It paints above the
opaque app chrome and below the ambiance canvas (`z-40`) and dialogs (`z-50` and
above).

Only the four handles set `pointer-events: auto`. The panel frame and the image
inherit `none`, so an ambient image never blocks a button, a link or a menu
underneath it. **This is a deliberate difference from the Club Code source**,
where the whole panel frame is interactive. In Club the panel is a child of the
message pane; here it is a full-window overlay above the whole app shell, so an
interactive frame would swallow clicks anywhere the user parked the image.

Theater presentation is unchanged from the previous slice: a faint full-bleed
wash at opacity `0.22`, `aria-hidden`, with no handles. It stays visible and
readable behind app content. The glow does not apply to theater presentation.

The floating layer is **not** `aria-hidden`, because a focusable control inside
an `aria-hidden` subtree is unreachable for assistive technology. The image
element carries `aria-hidden` instead and keeps `alt=""`.

### Limits

- Preset width never exceeds **29.3%** of the window width, the silver-ratio
  minor share `1 / (1 + delta_s)`. A fixed pixel width would otherwise cover most
  of a narrow window.
- Custom width never exceeds **70.7%**, the silver-ratio major share, which is
  exactly `1 / sqrt(2)`. The complementary 29.3% of the width always stays clear.
- Custom width is never below **120 px**, or the handles overlap. If the minimum
  is not reachable for a very tall image, the reachable maximum wins.
- Preset widths are `150`, `233` and `362` px. `large` is `delta_s` (about 2.414)
  times `small`; `medium` is the geometric mean of the two.
- Panel height is derived from the clamped width and the display-frame aspect
  ratio. Extreme images are letterboxed in a bounded frame that keeps all four
  handles separate; the image itself retains its proportions. Height is never stored, so a width change cannot make the panel taller
  than the window.
- If the requested preset size does not fit, the next smaller preset is used.
- Every geometry read and every pointer step passes the same clamp. A window
  resize, a sidebar change or a switch to a differently shaped image therefore
  recovers an off-screen panel with no user action.
- Reduced motion: the panel adds a 200 ms shadow and opacity transition only
  when `prefers-reduced-motion` is not `reduce`. Under `reduce` it adds no
  transition and no animation. A GIF still animates; that is the browser
  decoding the image the user chose, not motion the panel adds.

### Asset transport

The panel reuses the existing authenticated transport without change:
`resolveAmbientImageSrc` resolves the asset against the primary environment HTTP
target, and the asset schema accepts only
`/api/ambient-media/image/sha256-<64 hex>.<ext>`. No remote URL and no raw file
path is accepted or rendered. The panel adds no network call of its own.

### Geometry storage

Key `cafe-code:ambient-image-geometry`, version 1, one `image` slot holding
`{ x, y, width }` as pane fractions. Where a user dragged a decorative overlay
belongs to one screen, not to the account, so it never enters `ClientSettings`.

- An unreadable, corrupt or wrong-version document is removed, not repaired with
  a guess. The panel then returns to its preset.
- A repaired document is written back once, so the next read does not repeat it.
- A quota or privacy failure never breaks the panel that is already drawn.
  `readOrSeedAmbientImageGeometry` returns `null` when nothing could be stored,
  so the caller never reports a position that was not saved.

## Evidence

### Automated tests

| Suite                                                                      | Covers                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/ambientImageGeometry.test.ts` (14 tests)                     | Clamp bounds, rejection of non-geometry, storage round trip, repair of an overflowing rectangle, corrupt and wrong-version recovery, reset, unavailable and read-only storage, seeding.                                                                                                                                                                                          |
| `apps/web/src/ambientImagePanelLayout.test.ts` (11 tests)                  | Corner placement, silver-ratio width relation, step-down when a preset does not fit, the narrow-window bound, edge clamping, minimum and maximum width, height-driven width cap.                                                                                                                                                                                                 |
| `apps/web/src/components/ambient/AmbientImagePanel.browser.tsx` (12 tests) | Preset size and corner repaint, pointer move with layout promotion, pointer resize with aspect ratio held, clamping on drag and on resize, arrow-key move and resize, reset control and `Home` key, pane shrink recovery, image switch re-clamp, glow on and off, reduced motion with no transition, click-through frame, and listener plus `ResizeObserver` release on unmount. |

The existing `AmbientImageLayer.browser.tsx` and
`AmbientImageSettings.browser.tsx` suites still pass unchanged: 25 tests across
the three ambient browser files.

Focused commands used:

```
cd apps/web
yarn vitest run src/ambientImageGeometry.test.ts src/ambientImagePanelLayout.test.ts
yarn vitest run --config vitest.browser.config.ts --browser.headless --maxWorkers=2 \
  src/components/ambient/ src/components/settings/AmbientImageSettings.browser.tsx
```

### Defects this work found

- **Float mismatch in the clamp.** The reachable maximum width was computed with
  two algebraically equal expressions. They can differ in the last bit, and a
  minimum one bit above the maximum made the clamp report "no reachable
  rectangle" for a panel that does fit. Both sites now use one expression.
- **Preset width on a narrow window.** A fixed pixel preset covered more than
  half of a 414 px window. The preset is now bounded by the silver-ratio minor
  share. An existing browser test caught this.

### Media

`docs/pr-assets/ambient-image-panel/` holds the before and after stills and the
WebM of the same run. The images are generated gradients and the backend is a
mock; see the README in that directory. The capture is opt-in:

```
cd apps/web
yarn workspace @cafecode/web exec vitest run --config vitest.ambient-image-panel-capture.config.ts
```

## Not in this slice

- **No orphan sweeper.** Removing stored bytes that no settings document
  references belongs to a separate backend transaction scope.
- **No named profile.** The key split above is recorded for that slice.
- **No ambient video, and no provider SDK or adapter code** was copied from the
  Club Code source.
- **No GIF pause.** Club Code pauses an animated image while the window is
  hidden. That needs a `continueBackgroundAnimations` key, which this runtime
  does not have.
