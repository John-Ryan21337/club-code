import { describe, expect, it } from "vitest";
import { DEFAULT_LM_STUDIO_BASE_URL, ProviderDriverKind } from "@cafecode/contracts";

import {
  buildProviderCreationConfig,
  deriveProviderCreationInstanceId,
  isProviderCreationInstanceIdAvailable,
  LM_STUDIO_LOCAL_DISPLAY_NAME,
  LM_STUDIO_PROVIDER_TEMPLATE_ID,
} from "./providerInstanceCreation";
import { isLmStudioProviderInstance } from "../../providerInstances";

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
      displayName: LM_STUDIO_LOCAL_DISPLAY_NAME,
      accentColor: "#16a34a",
      config: {
        ossMode: true,
        ossBaseUrl: DEFAULT_LM_STUDIO_BASE_URL,
        runtimeSource: "system",
      },
    });
  });

  it("recognizes only Codex OSS envelopes as LM Studio instances", () => {
    expect(
      isLmStudioProviderInstance({
        driver: codex,
        config: { ossMode: true, ossBaseUrl: DEFAULT_LM_STUDIO_BASE_URL },
      }),
    ).toBe(true);
    expect(
      isLmStudioProviderInstance({
        driver: codex,
        config: { ossMode: false },
      }),
    ).toBe(false);
    expect(
      isLmStudioProviderInstance({
        driver: ProviderDriverKind.make("opencode"),
        config: { ossMode: true },
      }),
    ).toBe(false);
    expect(
      isLmStudioProviderInstance({
        driver: codex,
        config: [],
      }),
    ).toBe(false);
  });

  it("preserves a user-selected LAN endpoint on the LM Studio instance", () => {
    expect(
      buildProviderCreationConfig({
        templateId: LM_STUDIO_PROVIDER_TEMPLATE_ID,
        driver: codex,
        label: "GPU workstation",
        accentColor: "",
        config: { ossBaseUrl: "http://192.168.40.12:1234/v1" },
      }),
    ).toMatchObject({
      driver: codex,
      displayName: "GPU workstation",
      config: {
        ossMode: true,
        ossBaseUrl: "http://192.168.40.12:1234/v1",
      },
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
