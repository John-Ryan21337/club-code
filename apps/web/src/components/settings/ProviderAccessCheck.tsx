import { useId, useRef, useState, useSyncExternalStore } from "react";
import type {
  ProviderInstanceConfig,
  ProviderInstanceId,
  ServerProviderAccessInput,
  ServerProviderAccessResult,
  ServerProviderModel,
} from "@cafecode/contracts";
import { Button } from "../ui/button";
import {
  getServerSettingsWriteState,
  subscribeServerSettingsWrites,
} from "../../serverSettingsWriteState";

const STATUS_TEXT: Record<ServerProviderAccessResult["status"], string> = {
  verified: "Access verified",
  "authentication-required": "Sign in again, then check access.",
  "account-restricted": "The account cannot use this model. Check the provider account.",
  "rate-limited": "The provider reported a usage limit. Check the account before starting work.",
  unverified: "Access could not be verified. Check the connection and try again.",
  unsupported: "This provider does not support the access check.",
  busy: "A check is running or was just completed. Wait, then try again.",
};

interface ProviderAccessCheckProps {
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly checkAccess: (input: ServerProviderAccessInput) => Promise<ServerProviderAccessResult>;
}

/** A result belongs only to the saved configuration and model that were checked. */
export function ProviderAccessCheck({
  instanceId,
  instance,
  models,
  checkAccess,
}: ProviderAccessCheckProps) {
  const modelInputId = useId();
  const writes = useSyncExternalStore(
    subscribeServerSettingsWrites,
    getServerSettingsWriteState,
    getServerSettingsWriteState,
  );
  const [selectedModel, setSelectedModel] = useState("");
  const model = models.some((entry) => entry.slug === selectedModel)
    ? selectedModel
    : models.some((entry) => entry.slug === instance.defaultModel)
      ? instance.defaultModel!
      : (models[0]?.slug ?? "");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [observation, setObservation] = useState<{
    readonly instance: ProviderInstanceConfig;
    readonly instanceId: ProviderInstanceId;
    readonly model: string;
    readonly settingsRevision: number;
    readonly result: ServerProviderAccessResult | null;
  } | null>(null);
  const currentObservation =
    observation?.instance === instance &&
    observation.instanceId === instanceId &&
    observation.model === model &&
    observation.settingsRevision === writes.revision &&
    writes.pending === 0
      ? observation
      : null;

  const runCheck = async () => {
    const currentWrites = getServerSettingsWriteState();
    if (pendingRef.current || !model || instance.enabled === false || currentWrites.pending > 0)
      return;
    pendingRef.current = true;
    setPending(true);
    setObservation(null);
    const scope = { instance, instanceId, model, settingsRevision: currentWrites.revision };
    try {
      const result = await checkAccess({ instanceId, model });
      // Do not show a success response from another instance or model, even if
      // a stale transport or future server implementation returns one.
      setObservation({
        ...scope,
        result: result.instanceId === instanceId && result.model === model ? result : null,
      });
    } catch {
      // Transport errors can contain paths and raw provider output. Only fixed
      // product text crosses this boundary; a failure is never a live success.
      setObservation({ ...scope, result: null });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <section className="grid min-w-0 gap-2 border-t border-border/60 px-4 py-3 sm:px-5">
      <h4 className="text-xs font-medium">Check access before a long run</h4>
      <p className="text-xs text-muted-foreground">
        This sends a small live request with the saved Claude connection. It may use quota. Saved
        credentials alone do not prove access.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-0 flex-1 basis-48 gap-1 text-xs" htmlFor={modelInputId}>
          <span>Model to check</span>
          <select
            id={modelInputId}
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs"
            value={model}
            onChange={(event) => {
              setSelectedModel(event.target.value);
              setObservation(null);
            }}
            disabled={pending || models.length === 0}
          >
            {models.length === 0 ? <option value="">No models available</option> : null}
            {models.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || writes.pending > 0 || !model || instance.enabled === false}
          onClick={() => void runCheck()}
        >
          {pending ? "Checking access…" : writes.pending > 0 ? "Saving settings…" : "Check access"}
        </Button>
      </div>
      <div role="status" aria-live="polite" className="grid gap-1 text-xs text-muted-foreground">
        {currentObservation ? (
          <>
            <p>{STATUS_TEXT[currentObservation.result?.status ?? "unverified"]}</p>
            {currentObservation.result ? (
              <p>
                <span>Checked model</span>:{" "}
                <code className="break-all">{currentObservation.result.model}</code>
                {" · "}
                <time dateTime={currentObservation.result.checkedAt}>
                  {new Date(currentObservation.result.checkedAt).toLocaleString()}
                </time>
              </p>
            ) : null}
          </>
        ) : !pending ? (
          <p>Access has not been checked for this configuration and model.</p>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        A successful check does not guarantee access for the full run. Check each connection you
        plan to use.
      </p>
    </section>
  );
}
