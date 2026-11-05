import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import { CodexSettings } from "@cafecode/contracts";

import {
  buildCodexProviderAppServerArgs,
  fallbackCodexModelsFromSettings,
  parseCodexModelListResponse,
} from "./CodexProvider.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

describe("parseCodexModelListResponse", () => {
  it("uses the selected native cloud provider for discovery while preserving LM Studio precedence", () => {
    expect(buildCodexProviderAppServerArgs(false, "gcp")).toEqual([
      "app-server",
      "-c",
      'model_provider="gcp"',
    ]);
    expect(buildCodexProviderAppServerArgs(true, "gcp")).toEqual([
      "--oss",
      "--local-provider",
      "lmstudio",
      "app-server",
    ]);
  });
  it("discovers Astra Fast support from the 0.154.0 service tier", () => {
    const [astra] = parseCodexModelListResponse({
      data: [
        {
          defaultReasoningEffort: "medium",
          description: "Latest Codex model",
          displayName: "GPT-6-Astra",
          hidden: false,
          id: "gpt-6-astra",
          isDefault: true,
          model: "gpt-6-astra",
          supportedReasoningEfforts: [
            { description: "Medium reasoning", reasoningEffort: "medium" },
            { description: "Ultra reasoning", reasoningEffort: "ultra" },
          ],
          serviceTiers: [{ id: "priority", name: "Fast", description: "Priority processing" }],
        },
      ],
      nextCursor: null,
    });

    expect(astra).toMatchObject({
      slug: "gpt-6-astra",
      name: "GPT-6-Astra",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          { id: "reasoningEffort", currentValue: "medium" },
          { id: "fastMode", type: "boolean" },
        ],
      },
    });
  });

  it("lists Astra first in the cold-start fallback", () => {
    const models = fallbackCodexModelsFromSettings(
      decodeCodexSettings({ customModels: ["gpt-6-astra"] }),
    );
    expect(models[0]).toMatchObject({
      slug: "gpt-6-astra",
      name: "GPT-6-Astra",
      isCustom: false,
    });
    expect(models.filter((model) => model.slug === "gpt-6-astra")).toHaveLength(1);
  });

  it("exposes Terra 6.1 only after a compatible CLI is detected", () => {
    const settings = decodeCodexSettings({});
    for (const version of [
      undefined,
      null,
      "unavailable",
      "0.163.0",
      "0.164.0",
      "0.165.0-alpha.1",
    ]) {
      expect(
        fallbackCodexModelsFromSettings(settings, version).some(
          (model) => model.slug === "gpt-6.1-terra",
        ),
      ).toBe(false);
    }
    const terra = fallbackCodexModelsFromSettings(settings, "0.165.0").find(
      (model) => model.slug === "gpt-6.1-terra",
    );
    const reasoning = terra?.capabilities?.optionDescriptors?.find(
      (descriptor) => descriptor.id === "reasoningEffort",
    );
    expect(reasoning?.type).toBe("select");
    if (reasoning?.type !== "select") throw new Error("Missing Terra reasoning options");
    expect(reasoning.currentValue).toBe("low");
    expect(reasoning.options.map((option) => option.id)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    expect(terra?.capabilities?.optionDescriptors).toContainEqual({
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    });
  });

  it("preserves Codex model specialty metadata for provider safety policy", () => {
    const models = parseCodexModelListResponse({
      data: [
        {
          defaultReasoningEffort: "high",
          description: "Security-specialized model",
          displayName: "Security Model",
          hidden: false,
          id: "security-model",
          isDefault: false,
          model: "security-model",
          modelSpecialty: "cyber",
          supportedReasoningEfforts: [
            {
              description: "Thorough reasoning",
              reasoningEffort: "high",
            },
          ],
        },
      ],
      nextCursor: null,
    });

    expect(models).toHaveLength(1);
    expect(models[0]?.modelSpecialty).toBe("cyber");
  });
});
