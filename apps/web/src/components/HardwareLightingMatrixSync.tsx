import { useEffect } from "react";

import { useSettings } from "../hooks/useSettings";
import { ensureLocalApi } from "../localApi";
import { matrixColorFrameStore } from "../matrixColorFrameStore";
import { matrixHardwareLightingColors } from "../matrixHardwareLightingFrame";

const FRAME_INTERVAL_MS = 50;
const LEASE_HEARTBEAT_MS = 1_000;

/**
 * The desktop renderer is the sole palette publisher. Remote WebUI clients can
 * configure the shared setting, but cannot compete with the host for physical
 * lighting writes. A one-second heartbeat keeps the server's three-second
 * safety lease alive when the Matrix palette is frozen or unchanged.
 */
export function HardwareLightingMatrixSync() {
  const enabled = useSettings(
    (settings) =>
      settings.hardwareLightingSyncEnabled &&
      settings.fallingEffectsEnabled &&
      settings.fallingEffectKind === "matrix" &&
      settings.hardwareLightingControllerIds.length > 0,
  );

  useEffect(() => {
    if (window.desktopBridge === undefined) return;
    let disposed = false;
    let sequence = 0;
    let lastSentAt = Number.NEGATIVE_INFINITY;
    let scheduled: ReturnType<typeof setTimeout> | null = null;

    const send = (active: boolean) => {
      if (disposed) return;
      const snapshot = matrixColorFrameStore.getSnapshot();
      if (active && snapshot === null) return;
      lastSentAt = performance.now();
      sequence += 1;
      void ensureLocalApi()
        .server.applyHardwareLightingFrame({
          sequence,
          active,
          colors: snapshot === null ? [] : matrixHardwareLightingColors(snapshot.frame),
        })
        .catch((error) => {
          console.error("[HARDWARE_LIGHTING] Matrix frame delivery failed", error);
        });
    };

    const publish = () => {
      if (!enabled) return;
      const elapsed = performance.now() - lastSentAt;
      if (elapsed >= FRAME_INTERVAL_MS) {
        send(true);
        return;
      }
      if (scheduled !== null) return;
      scheduled = setTimeout(() => {
        scheduled = null;
        send(true);
      }, FRAME_INTERVAL_MS - elapsed);
    };

    if (enabled) publish();
    else send(false);
    const unsubscribe = enabled ? matrixColorFrameStore.subscribe(publish) : () => {};
    const heartbeat = enabled ? setInterval(() => send(true), LEASE_HEARTBEAT_MS) : null;

    return () => {
      disposed = true;
      unsubscribe();
      if (scheduled !== null) clearTimeout(scheduled);
      if (heartbeat !== null) clearInterval(heartbeat);
      if (enabled) {
        sequence += 1;
        void ensureLocalApi()
          .server.applyHardwareLightingFrame({ sequence, active: false, colors: [] })
          .catch(() => {});
      }
    };
  }, [enabled]);

  return null;
}
