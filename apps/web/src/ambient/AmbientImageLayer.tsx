import { useEffect, useMemo, useRef, useState } from "react";
import type { AmbientImageAsset } from "@cafecode/contracts/settings";

import { resolveAmbientImageSrc } from "../ambientImages";
import { useSettings } from "../hooks/useSettings";

/**
 * AmbientImageLayer renders the user's own uploaded image or GIF as a
 * decorative overlay. It is deliberately inert: a single `<img>` pointed at an
 * authenticated, content-addressed Cafe route, never a remote URL and never a
 * document that could execute. GIF animation is left to the browser so the
 * frame budget validated at upload is the only decoding work.
 *
 * Stacking: the app shell paints opaque chrome (`bg-card` sidebar, themed
 * content surfaces), so a layer parked underneath it at `z-0` is invisible in
 * the real layout. The layer therefore sits *above* app content at `z-30` —
 * below the ambiance canvas (z-40) and well below dialogs, popovers and toasts
 * (z-50+) — and is `pointer-events-none`, so every control underneath stays
 * clickable and no modal work is ever obscured. Readability is protected by
 * bounding opacity rather than by hiding the layer: theater mode is a faint
 * full-bleed wash, floating mode is a small corner panel that stays clear of
 * the thread column.
 */
const THEATER_OPACITY = 0.22;

export function AmbientImageLayer() {
  const enabled = useSettings((settings) => settings.ambientImageEnabled);
  const asset = useSettings((settings) => settings.ambientImageAsset);
  const cycleEnabled = useSettings((settings) => settings.ambientImageCycleEnabled);
  const cycleAssets = useSettings((settings) => settings.ambientImageCycleAssets);
  const cycleSeconds = useSettings((settings) => settings.ambientImageCycleSeconds);
  const presentationMode = useSettings((settings) => settings.ambientImagePresentationMode);

  const cycling = cycleEnabled && cycleAssets.length > 1;
  const [index, setIndex] = useState(0);

  // Restart the rotation whenever the library identity changes so a removed
  // entry can never leave the timer pointing past the end of the list.
  const cycleKey = useMemo(() => cycleAssets.map((entry) => entry.id).join("|"), [cycleAssets]);
  const lastCycleKey = useRef(cycleKey);
  if (lastCycleKey.current !== cycleKey) {
    lastCycleKey.current = cycleKey;
    if (index !== 0) setIndex(0);
  }

  useEffect(() => {
    if (!enabled || !cycling) return;
    const interval = window.setInterval(
      () => setIndex((current) => (current + 1) % cycleAssets.length),
      Math.max(1, cycleSeconds) * 1_000,
    );
    return () => window.clearInterval(interval);
  }, [enabled, cycling, cycleAssets.length, cycleSeconds]);

  // A library entry the user uploaded but never explicitly selected is still
  // something they expect to see once the feature is on.
  const shown: AmbientImageAsset | null = !enabled
    ? null
    : cycleEnabled && cycleAssets.length > 0
      ? (cycleAssets[index % cycleAssets.length] ?? null)
      : (asset ?? cycleAssets[0] ?? null);
  if (!shown) return null;

  const theater = presentationMode === "theater";
  return (
    <div
      aria-hidden
      data-testid="ambient-image-layer"
      data-ambient-image-mode={theater ? "theater" : "floating"}
      className="pointer-events-none fixed inset-0 z-30 overflow-hidden"
    >
      <img
        key={shown.id}
        src={resolveAmbientImageSrc(shown)}
        alt=""
        decoding="async"
        draggable={false}
        data-ambient-image-id={shown.id}
        // GIFs animate natively here; the decode budget was bounded at upload.
        style={theater ? { opacity: THEATER_OPACITY } : undefined}
        className={
          theater
            ? "h-full w-full object-cover"
            : "absolute right-6 bottom-6 max-h-[28vh] max-w-[26vw] rounded-xl border border-border object-contain opacity-80 shadow-lg"
        }
      />
    </div>
  );
}
