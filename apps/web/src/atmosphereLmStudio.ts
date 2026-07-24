import {
  decodeAtmosphereCommandProposal,
  MAX_ATMOSPHERE_COMMAND_LENGTH,
  type AtmosphereCommand,
} from "./atmosphereCommandParser";

export const ATMOSPHERE_LM_STUDIO_ORIGIN = "http://127.0.0.1:1234";
export const ATMOSPHERE_LM_STUDIO_MAX_RESPONSE_BYTES = 32 * 1024;
export const ATMOSPHERE_LM_STUDIO_TIMEOUT_MS = 8_000;

const SYSTEM_PROMPT = `You translate one short atmosphere/media request into strict JSON.
Return exactly {"commands":[...]} with at most four commands. Allowed commands:
{"kind":"set-effect","effect":"off|snow|rain|matrix"}
{"kind":"adjust-effect","property":"density|speed|opacity","direction":"increase|decrease"}
{"kind":"set-effect-value","property":"density|speed|opacity|japanese-ratio","percent":0..100}
{"kind":"set-effect-color","color":"#rrggbb"}
{"kind":"set-2ch","enabled":true|false}
{"kind":"media-transport","action":"next|previous|play|pause|stop"}
{"kind":"play-url","url":"exact URL from the request"}
{"kind":"visualizer","action":"next|previous|random|toggle"}
If nothing is safely supported, return {"commands":[]}. Never add URLs or other fields.`;

export class AtmosphereLmStudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtmosphereLmStudioError";
  }
}

interface AtmosphereLmStudioDependencies {
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > ATMOSPHERE_LM_STUDIO_MAX_RESPONSE_BYTES) {
    throw new AtmosphereLmStudioError("LM Studio returned an oversized response.");
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > ATMOSPHERE_LM_STUDIO_MAX_RESPONSE_BYTES) {
      throw new AtmosphereLmStudioError("LM Studio returned an oversized response.");
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let output = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > ATMOSPHERE_LM_STUDIO_MAX_RESPONSE_BYTES) {
        throw new AtmosphereLmStudioError("LM Studio returned an oversized response.");
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

async function fetchWithTimeout(
  fetchImpl: typeof globalThis.fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AtmosphereLmStudioError("LM Studio did not answer in time.");
    }
    throw new AtmosphereLmStudioError(
      error instanceof Error
        ? `Could not reach local LM Studio: ${error.message}`
        : "Could not reach local LM Studio.",
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function resolveLoadedModel(dependencies: AtmosphereLmStudioDependencies): Promise<string> {
  const response = await fetchWithTimeout(
    dependencies.fetch,
    `${ATMOSPHERE_LM_STUDIO_ORIGIN}/v1/models`,
    {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    },
    dependencies.timeoutMs ?? ATMOSPHERE_LM_STUDIO_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new AtmosphereLmStudioError(`LM Studio model check failed (${response.status}).`);
  }
  let decoded: unknown;
  try {
    decoded = parseJson(await readBoundedText(response));
  } catch (error) {
    if (error instanceof AtmosphereLmStudioError) throw error;
    throw new AtmosphereLmStudioError("LM Studio returned an invalid model list.");
  }
  if (typeof decoded !== "object" || decoded === null) {
    throw new AtmosphereLmStudioError("LM Studio returned an invalid model list.");
  }
  const data = (decoded as { readonly data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new AtmosphereLmStudioError("LM Studio returned an invalid model list.");
  }
  const model = data.find(
    (candidate): candidate is { readonly id: string } =>
      typeof candidate === "object" &&
      candidate !== null &&
      typeof (candidate as { readonly id?: unknown }).id === "string" &&
      (candidate as { readonly id: string }).id.length > 0 &&
      (candidate as { readonly id: string }).id.length <= 256,
  );
  if (!model) {
    throw new AtmosphereLmStudioError("Load a model in LM Studio first.");
  }
  return model.id;
}

/**
 * Optional loopback-only fallback for wording the deterministic parser does
 * not understand. It sends exactly one bounded control sentence—never chat,
 * project, file, agent, credential, or provider-session context.
 */
export async function interpretAtmosphereCommandWithLmStudio(
  rawInput: string,
  dependencies: AtmosphereLmStudioDependencies = { fetch: globalThis.fetch },
): Promise<readonly AtmosphereCommand[]> {
  const input = rawInput.trim().slice(0, MAX_ATMOSPHERE_COMMAND_LENGTH);
  if (!input) return [];
  const model = await resolveLoadedModel(dependencies);
  const response = await fetchWithTimeout(
    dependencies.fetch,
    `${ATMOSPHERE_LM_STUDIO_ORIGIN}/v1/chat/completions`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 160,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input },
        ],
      }),
    },
    dependencies.timeoutMs ?? ATMOSPHERE_LM_STUDIO_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new AtmosphereLmStudioError(`LM Studio command failed (${response.status}).`);
  }

  let decoded: unknown;
  try {
    decoded = parseJson(await readBoundedText(response));
  } catch (error) {
    if (error instanceof AtmosphereLmStudioError) throw error;
    throw new AtmosphereLmStudioError("LM Studio returned invalid JSON.");
  }
  if (typeof decoded !== "object" || decoded === null) {
    throw new AtmosphereLmStudioError("LM Studio returned an invalid command.");
  }
  const choices = (decoded as { readonly choices?: unknown }).choices;
  const content =
    Array.isArray(choices) &&
    typeof choices[0] === "object" &&
    choices[0] !== null &&
    typeof (choices[0] as { readonly message?: unknown }).message === "object" &&
    (choices[0] as { readonly message?: unknown }).message !== null
      ? (
          choices[0] as {
            readonly message: { readonly content?: unknown };
          }
        ).message.content
      : null;
  if (typeof content !== "string" || content.length > ATMOSPHERE_LM_STUDIO_MAX_RESPONSE_BYTES) {
    throw new AtmosphereLmStudioError("LM Studio returned an invalid command.");
  }

  let proposal: unknown;
  try {
    proposal = parseJson(content);
  } catch {
    throw new AtmosphereLmStudioError("LM Studio returned invalid command JSON.");
  }
  return decodeAtmosphereCommandProposal(proposal, input);
}
