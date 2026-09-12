import { useEffect, useSyncExternalStore } from "react";

import { usePrimaryEnvironmentId } from "../environments/primary";
import {
  readEnvironmentConnection,
  subscribeEnvironmentConnections,
} from "../environments/runtime";
import { useSettings } from "../hooks/useSettings";
import { matrixColorFrameStore } from "../matrixColorFrameStore";
import { matrixHardwareLightingColors } from "../matrixHardwareLightingFrame";
import { useServerConfig } from "../rpc/serverState";

const FRAME_INTERVAL_MS = 50;
const LEASE_HEARTBEAT_MS = 1_000;

/** The desktop publishes the resolved palette. The server independently requires owner authority. */
export function HardwareLightingMatrixSync() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const connection = useSyncExternalStore(
    subscribeEnvironmentConnections,
    () => (primaryEnvironmentId === null ? null : readEnvironmentConnection(primaryEnvironmentId)),
    () => null,
  );
  const available = useServerConfig()?.ambientExperienceCapabilities.atmosphere === true;
  const selected = useSettings(
    (settings) =>
      settings.hardwareLightingSyncEnabled &&
      settings.fallingEffectsEnabled &&
      settings.fallingEffectKind === "matrix" &&
      settings.hardwareLightingControllerIds.length > 0,
  );
  const enabled = selected && available;

  useEffect(() => {
    if (window.desktopBridge === undefined || connection === null || primaryEnvironmentId === null)
      return;
    let disposed = false;
    let sequence = 0;
    let lastSentAt = Number.NEGATIVE_INFINITY;
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let pendingActive: boolean | null = null;
    const current = () =>
      !disposed && readEnvironmentConnection(primaryEnvironmentId) === connection;

    const send = (active: boolean) => {
      if (!current()) return;
      if (inFlight) {
        pendingActive = active;
        return;
      }
      const snapshot = matrixColorFrameStore.getSnapshot();
      if (active && snapshot === null) return;
      lastSentAt = performance.now();
      inFlight = true;
      void connection.client.server
        .applyHardwareLightingFrame({
          sequence: ++sequence,
          active,
          colors: active && snapshot !== null ? matrixHardwareLightingColors(snapshot.frame) : [],
        })
        .catch(() => {
          // Status controls report fixed server state; never log device or transport errors here.
        })
        .finally(() => {
          inFlight = false;
          if (!current() || pendingActive === null) return;
          const next = pendingActive;
          pendingActive = null;
          send(next);
        });
    };

    const publish = () => {
      if (!enabled || !current()) return;
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
      // One final stop may coexist with the owned frame. The server coalesces it
      // behind that frame; the three-second lease also covers a lost socket.
      if (enabled && readEnvironmentConnection(primaryEnvironmentId) === connection) {
        void connection.client.server
          .applyHardwareLightingFrame({ sequence: ++sequence, active: false, colors: [] })
          .catch(() => {});
      }
    };
  }, [connection, enabled, primaryEnvironmentId]);

  return null;
}
