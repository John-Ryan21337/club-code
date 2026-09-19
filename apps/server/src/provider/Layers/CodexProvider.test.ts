import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import { CodexSettings } from "@cafecode/contracts";

import { fallbackCodexModelsFromSettings, parseCodexModelListResponse } from "./CodexProvider.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

describe("parseCodexModelListResponse", () => {
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
