import { describe, expect, it } from "vitest";
import { ProviderDriverKind } from "@cafecode/contracts";

import {
  buildProviderCreationConfig,
  deriveProviderCreationInstanceId,
  isProviderCreationInstanceIdAvailable,
  LM_STUDIO_PROVIDER_TEMPLATE_ID,
} from "./providerInstanceCreation";

describe("provider instance creation", () => {
  const codex = ProviderDriverKind.make("codex");

  it("creates a distinctly named selectable LM Studio instance through Codex OSS", () => {
    expect(
      buildProviderCreationConfig({
        templateId: LM_STUDIO_PROVIDER_TEMPLATE_ID,
        driver: codex,
        label: "",
        accentColor: "#16a34a",
        config: { ossMode: false, runtimeSource: "system" },
      }),
    ).toEqual({
      driver: codex,
      enabled: true,
      displayName: "LM Studio",
      accentColor: "#16a34a",
      config: { ossMode: true, runtimeSource: "system" },
    });
  });

  it("keeps ordinary Codex instances on their requested cloud configuration", () => {
    expect(
      buildProviderCreationConfig({
        templateId: codex,
        driver: codex,
        label: "Work",
        accentColor: "",
        config: {},
      }),
    ).toEqual({
      driver: codex,
      enabled: true,
      displayName: "Work",
    });
  });

  it("derives stable LM Studio routing ids and validates collisions", () => {
    expect(deriveProviderCreationInstanceId(LM_STUDIO_PROVIDER_TEMPLATE_ID, codex, "")).toBe(
      "lmstudio",
    );
    expect(
      deriveProviderCreationInstanceId(LM_STUDIO_PROVIDER_TEMPLATE_ID, codex, "Studio Two"),
    ).toBe("lmstudio_studio_two");
    expect(isProviderCreationInstanceIdAvailable("lmstudio", new Set(["lmstudio"]))).toBe(
      "An instance named 'lmstudio' already exists.",
    );
    expect(isProviderCreationInstanceIdAvailable("lmstudio_two", new Set())).toBeNull();
  });
});
