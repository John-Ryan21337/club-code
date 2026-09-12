import { useEffect, useRef, useState } from "react";
import type { ServerProvider, ServerProviderResetCreditOutcome } from "@cafecode/contracts";
import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { Button } from "../ui/button";

const outcomeText: Record<ServerProviderResetCreditOutcome, string> = {
  reset: "The provider reset the usage limit. Refresh usage to read the new balance.",
  nothingToReset: "The provider reports that no usage limit needs a reset.",
  noCredit: "The provider reports that this credit is not available.",
  alreadyRedeemed: "The provider reports that this credit was already used.",
};
function availableCredit(provider: ServerProvider, stale: boolean) {
  return provider.runtimeCapabilities?.resetCredit === true &&
    provider.enabled &&
    provider.installed &&
    provider.auth.status === "authenticated" &&
    provider.auth.type === "chatgpt" &&
    Boolean(provider.auth.email) &&
    !stale
    ? provider.accountRateLimits?.rateLimitResetCredits?.credits?.find(
        (item) =>
          item.status === "available" &&
          item.resetType === "codexRateLimits" &&
          (item.expiresAt == null || item.expiresAt * 1000 > Date.now()),
      )
    : undefined;
}
export function ProviderResetCredit({
  provider,
  stale,
}: {
  provider: ServerProvider;
  stale: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const alive = useRef(false);
  const busy = useRef(false);
  const confirmedConnection = useRef<ReturnType<typeof getPrimaryEnvironmentConnection> | null>(
    null,
  );
  const latest = useRef({ provider, stale });
  latest.current = { provider, stale };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const credit = availableCredit(provider, stale);
  const identity = `${provider.instanceId}\0${provider.auth.email ?? ""}\0${credit?.id ?? ""}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  useEffect(() => {
    setConfirming(false);
    setResult(null);
  }, [identity]);
  if (!credit) return null;
  const consume = async () => {
    if (
      busy.current ||
      !confirming ||
      !alive.current ||
      currentIdentity.current !== identity ||
      availableCredit(latest.current.provider, latest.current.stale)?.id !== credit.id ||
      confirmedConnection.current !== getPrimaryEnvironmentConnection()
    )
      return;
    busy.current = true;
    setPending(true);
    setConfirming(false);
    try {
      const connection = getPrimaryEnvironmentConnection();
      const outcome = await connection.client.server.consumeResetCredit({
        instanceId: provider.instanceId,
        expectedEmail: provider.auth.email!,
        creditId: credit.id,
        attemptId: crypto.randomUUID(),
      });
      if (
        alive.current &&
        currentIdentity.current === identity &&
        connection === getPrimaryEnvironmentConnection()
      )
        setResult(outcomeText[outcome]);
    } catch {
      if (
        alive.current &&
        currentIdentity.current === identity &&
        confirmedConnection.current === getPrimaryEnvironmentConnection()
      )
        setResult(
          "The reset result is unknown. Refresh usage before another attempt. This request will not retry automatically.",
        );
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  };
  return (
    <div className="space-y-1 rounded-lg border border-sidebar-border p-2">
      {result ? <p role="status">{result}</p> : null}
      {confirming ? (
        <>
          <p>
            Use one reset credit for <bdi className="break-all">{provider.auth.email}</bdi>? A used
            credit cannot be restored.
          </p>
          <div className="flex gap-2">
            <Button size="xs" variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button size="xs" onClick={() => void consume()}>
              Confirm use of one credit
            </Button>
          </div>
        </>
      ) : (
        <Button
          size="xs"
          variant="outline"
          disabled={pending || result !== null}
          onClick={() => {
            confirmedConnection.current = getPrimaryEnvironmentConnection();
            setConfirming(true);
          }}
        >
          {pending ? "Using reset credit…" : "Use one reset credit"}
        </Button>
      )}
    </div>
  );
}
