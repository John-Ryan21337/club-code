import type { ClientSettingsPatch, HardwareLightingStatus } from "@cafecode/contracts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { usePrimaryEnvironmentId } from "../../environments/primary";
import {
  readEnvironmentConnection,
  subscribeEnvironmentConnections,
} from "../../environments/runtime";
import { useSettings } from "../../hooks/useSettings";
import { applyClientSettingsUpdated } from "../../rpc/serverState";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function HardwareLightingSettings() {
  const settings = useSettings();
  const environmentId = usePrimaryEnvironmentId();
  const connection = useSyncExternalStore(
    subscribeEnvironmentConnections,
    () => (environmentId === null ? null : readEnvironmentConnection(environmentId)),
    () => null,
  );
  const [status, setStatus] = useState<HardwareLightingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const admission = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    admission.current = false;
    setBusy(false);
    setStatus(null);
    setFeedback(null);
    if (connection === null || environmentId === null) return;
    const current = () =>
      generation.current === currentGeneration &&
      readEnvironmentConnection(environmentId) === connection;
    admission.current = true;
    setBusy(true);
    void connection.client.server
      .getHardwareLightingStatus()
      .then((value) => {
        if (current()) setStatus(value);
      })
      .catch(() => {
        if (current())
          setFeedback(
            "Hardware lighting requires an owner session over HTTPS or a same-machine Cafe connection.",
          );
      })
      .finally(() => {
        if (current()) {
          admission.current = false;
          setBusy(false);
        }
      });
    return () => {
      generation.current += 1;
    };
  }, [connection, environmentId]);

  const perform = async (patch?: ClientSettingsPatch) => {
    if (
      admission.current ||
      connection === null ||
      environmentId === null ||
      readEnvironmentConnection(environmentId) !== connection
    )
      return;
    admission.current = true;
    setBusy(true);
    setFeedback(null);
    const currentGeneration = generation.current;
    const current = () =>
      generation.current === currentGeneration &&
      readEnvironmentConnection(environmentId) === connection;
    try {
      if (patch !== undefined) {
        const saved = await connection.client.server.updateClientSettings(patch);
        if (!current()) return;
        applyClientSettingsUpdated(saved);
        const value = await connection.client.server.getHardwareLightingStatus();
        if (current()) {
          setStatus(value);
          setFeedback("Lighting settings saved.");
        }
      } else {
        const value = await connection.client.server.refreshHardwareLighting();
        if (current()) setStatus(value);
      }
    } catch {
      if (current())
        setFeedback(
          "The operation was not confirmed. Check the connection and lighting status before trying again.",
        );
    } finally {
      if (current()) {
        admission.current = false;
        setBusy(false);
      }
    }
  };

  const canEdit = status !== null && !busy;
  const toggleController = (id: string, selected: boolean) => {
    const ids = settings.hardwareLightingControllerIds.filter((value) => value !== id);
    void perform({ hardwareLightingControllerIds: selected ? [...ids, id] : ids });
  };

  return (
    <SettingsSection title="Hardware lighting">
      <SettingsRow
        title="OpenRGB connection"
        description="Control selected devices on the primary Cafe server. Start OpenRGB's SDK server yourself at 127.0.0.1:6742. Cafe does not start it or change its address."
        status={status ? `${status.state}: ${status.detail}` : "Status is not available."}
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={busy || connection === null}
            onClick={() => void perform()}
          >
            Refresh devices
          </Button>
        }
      />
      <SettingsRow
        title="Sync Matrix colors"
        description="Off by default. Selected devices follow the shared Matrix colors. Enable Matrix and keep a Cafe desktop renderer connected. Device restoration is best effort."
        control={
          <Switch
            aria-label="Sync Matrix hardware lighting"
            checked={settings.hardwareLightingSyncEnabled}
            disabled={!canEdit}
            onCheckedChange={(value) => void perform({ hardwareLightingSyncEnabled: value })}
          />
        }
      />
      <SettingsRow
        title="Selected devices"
        description="Only supported devices that you select receive colors. Refresh is manual; device identities are based on the reported OpenRGB metadata."
      >
        <div className="space-y-2 pb-4">
          {status?.controllers.length ? (
            status.controllers.map((controller) => (
              <label key={controller.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={settings.hardwareLightingControllerIds.includes(controller.id)}
                  disabled={!canEdit || !controller.supported}
                  onChange={(event) => toggleController(controller.id, event.currentTarget.checked)}
                />
                <span>
                  {controller.name} · {controller.ledCount} LEDs
                  {controller.supported ? "" : " · not supported"}
                </span>
              </label>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              No devices reported. Select Refresh devices after starting OpenRGB.
            </p>
          )}
          {settings.hardwareLightingControllerIds.some(
            (id) => !status?.controllers.some((controller) => controller.id === id),
          ) ? (
            <p className="text-xs text-muted-foreground">
              Some saved devices are not in the current list.
            </p>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={!canEdit || settings.hardwareLightingControllerIds.length === 0}
            onClick={() => void perform({ hardwareLightingControllerIds: [] })}
          >
            Clear selection
          </Button>
        </div>
      </SettingsRow>
      <SettingsRow
        title="Lighting brightness"
        description="Scale the resolved Matrix colors from 5 to 100 percent."
        control={
          <select
            aria-label="Hardware lighting brightness"
            value={settings.hardwareLightingBrightness}
            disabled={!canEdit}
            onChange={(event) =>
              void perform({ hardwareLightingBrightness: Number(event.currentTarget.value) })
            }
            className="rounded-md border bg-background px-2 py-1 text-xs"
          >
            {[0.05, 0.1, 0.25, 0.5, 0.75, 1].map((value) => (
              <option key={value} value={value}>
                {Math.round(value * 100)}%
              </option>
            ))}
            {![0.05, 0.1, 0.25, 0.5, 0.75, 1].includes(settings.hardwareLightingBrightness) ? (
              <option value={settings.hardwareLightingBrightness}>
                {Math.round(settings.hardwareLightingBrightness * 100)}%
              </option>
            ) : null}
          </select>
        }
      />
      <SettingsRow
        title="Restore device colors"
        description="Try to restore the captured mode and colors when sync stops. Turning this off leaves the last colors on the device."
        control={
          <Switch
            aria-label="Restore hardware lighting on disable"
            checked={settings.hardwareLightingRestoreOnDisable}
            disabled={!canEdit}
            onCheckedChange={(value) => void perform({ hardwareLightingRestoreOnDisable: value })}
          />
        }
      />
      {feedback ? (
        <p role="status" className="border-t px-4 py-3 text-xs text-muted-foreground">
          {feedback}
        </p>
      ) : null}
    </SettingsSection>
  );
}
