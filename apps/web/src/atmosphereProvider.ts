import type { ProviderInstanceConfig, ServerConfig, ServerProvider } from "@cafecode/contracts";
import * as Equal from "effect/Equal";
import type { WsRpcClient } from "./rpc/wsRpcClient";
import { decodeAtmosphereModelProposal } from "./atmosphereModelProposal";
import { getServerSettingsWriteState } from "./serverSettingsWriteState";

export class AtmosphereProviderError extends Error {
  constructor() {
    super(
      "The selected provider did not return a current supported command batch. Nothing changed.",
    );
  }
}

/** Compare the redacted envelope, including exact home and environment configuration. */
export function atmosphereProviderConfig(
  config: ServerConfig | null,
  provider: ServerProvider,
): ProviderInstanceConfig | undefined {
  const explicit = config?.settings.providerInstances[provider.instanceId];
  if (explicit) return explicit;
  if (provider.instanceId === "claudeAgent" && provider.driver === "claudeAgent" && config) {
    return { driver: provider.driver, config: config.settings.providers.claudeAgent };
  }
  return undefined;
}

export async function interpretAtmosphereWithProvider(
  request: string,
  provider: ServerProvider,
  model: string,
  api: Pick<WsRpcClient["server"], "getConfig" | "interpretAtmosphereCommand">,
  readConfig: () => ServerConfig | null,
  isCurrent: () => boolean,
) {
  const displayed = atmosphereProviderConfig(readConfig(), provider);
  const writes = getServerSettingsWriteState();
  let expired = false;
  const matchesProvider = (config: ServerConfig | null) => {
    const live = config?.providers.find((entry) => entry.instanceId === provider.instanceId);
    return (
      live?.driver === provider.driver &&
      live.enabled &&
      live.installed &&
      Equal.equals(live.auth, provider.auth) &&
      live.models.some((entry) => entry.slug === model) &&
      Equal.equals(atmosphereProviderConfig(config, live), displayed)
    );
  };
  const current = () => {
    const config = readConfig();
    const nextWrites = getServerSettingsWriteState();
    return (
      !expired &&
      isCurrent() &&
      writes.pending === 0 &&
      nextWrites.pending === 0 &&
      nextWrites.revision === writes.revision &&
      matchesProvider(config)
    );
  };
  if (provider.driver !== "claudeAgent" || !displayed || !current())
    throw new AtmosphereProviderError();
  // The shared websocket transport has no request deadline. Include both fresh
  // config reads so a late first response cannot start a paid request afterward.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new AtmosphereProviderError());
    }, 45_000);
  });
  const work = async () => {
    const saved = await api.getConfig();
    if (!current() || !matchesProvider(saved)) throw new AtmosphereProviderError();
    const result = await api.interpretAtmosphereCommand({
      instanceId: provider.instanceId,
      model,
      request,
      expectedAuth: provider.auth,
      expectedConfig: displayed,
    });
    if (
      !current() ||
      result.status !== "completed" ||
      result.instanceId !== provider.instanceId ||
      result.model !== model ||
      !result.proposal ||
      result.proposal.length > 4096
    )
      throw new AtmosphereProviderError();
    const commands = decodeAtmosphereModelProposal(JSON.parse(result.proposal));
    if (commands.length === 0) throw new AtmosphereProviderError();
    const after = await api.getConfig();
    if (!current() || !matchesProvider(after)) throw new AtmosphereProviderError();
    return { commands, isCurrent: current };
  };
  try {
    return await Promise.race([work(), deadline]);
  } catch {
    throw new AtmosphereProviderError();
  } finally {
    clearTimeout(timer);
  }
}
