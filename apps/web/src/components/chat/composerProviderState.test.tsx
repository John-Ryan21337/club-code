import { describe, expect, it } from "vitest";
import {
  CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID,
  CODEX_AUTO_DELEGATE_OPTION_ID,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@cafecode/contracts";
import {
  getComposerProviderState,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./composerProviderState";

// Everything in composerProviderState is now data-driven by the model's
// optionDescriptors, so these tests use a single synthetic provider/model and
// vary only the descriptor shape per scenario.

const PROVIDER: ProviderDriverKind = ProviderDriverKind.make("codex");
const PROVIDER_INSTANCE = ProviderInstanceId.make("codex");
const MODEL = "test-model";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  promptInjectedValues?: ReadonlyArray<string>,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  const defaultId = options.find((option) => option.isDefault)?.id;
  return {
    id,
    label: id,
    type: "select",
    options: [...options],
    ...(defaultId ? { currentValue: defaultId } : {}),
    ...(promptInjectedValues && promptInjectedValues.length > 0
      ? { promptInjectedValues: [...promptInjectedValues] }
      : {}),
  };
}

function booleanDescriptor(id: string): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return { id, label: id, type: "boolean" };
}

function modelWith(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ServerProviderModel> {
  return [
    { slug: MODEL, name: MODEL, isCustom: false, capabilities: { optionDescriptors: descriptors } },
  ];
}

function selections(
  ...entries: Array<readonly [string, string | boolean]>
): ReadonlyArray<ProviderOptionSelection> {
  return entries.map(([id, value]) => ({ id, value }));
}

const ULTRATHINK_FRAME_CLASSES = {
  composerFrameClassName: "ultrathink-frame",
  composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]",
  modelPickerIconClassName: "ultrathink-chroma",
} as const;

describe("getComposerProviderState", () => {
  it.each([
    ["unset", [], "default"],
    ["legacy Fast On", [["fastMode", true]], "priority"],
    ["saved Ultra Fast", [["serviceTier", "ultrafast"]], "ultrafast"],
    [
      "explicit standard wins",
      [
        ["serviceTier", "default"],
        ["fastMode", true],
      ],
      "default",
    ],
    [
      "unsupported tier",
      [
        ["serviceTier", "unknown"],
        ["fastMode", true],
      ],
      "default",
    ],
  ] as const)("dispatches %s using only supported native speed tiers", (_name, saved, expected) => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      prompt: "",
      modelOptions: selections(...saved),
      models: modelWith([
        {
          ...selectDescriptor("serviceTier", [
            { id: "default", label: "Standard" },
            { id: "priority", label: "Fast" },
            { id: "ultrafast", label: "Ultra Fast", isDefault: true },
          ]),
          currentValue: "ultrafast",
        },
        booleanDescriptor("fastMode"),
      ]),
    });
    expect(state.modelOptionsForDispatch).toEqual(selections(["serviceTier", expected]));
  });

  it("falls back to standard when a saved Ultra Fast choice moves to a Fast-only model", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      prompt: "",
      modelOptions: selections(["serviceTier", "ultrafast"], ["fastMode", true]),
      models: modelWith([booleanDescriptor("fastMode")]),
    });
    expect(state.modelOptionsForDispatch).toEqual(selections(["fastMode", false]));
  });

  it("replaces legacy CLI effort defaults with High and dispatches a smaller context independently", () => {
    const models = modelWith([
      selectDescriptor("contextWindow", [
        { id: "1m", label: "1M", isDefault: true },
        { id: "200k", label: "200k" },
      ]),
      selectDescriptor("effort", [
        { id: "default", label: "CLI default", isDefault: true },
        { id: "high", label: "High" },
        { id: "low", label: "Low" },
      ]),
    ]);
    const input = { provider: PROVIDER, model: MODEL, models, prompt: "" };
    expect(
      getComposerProviderState({ ...input, modelOptions: selections(["effort", "default"]) }),
    ).toMatchObject({
      promptEffort: "high",
      modelOptionsForDispatch: selections(["contextWindow", "200k"], ["effort", "high"]),
    });
    expect(
      getComposerProviderState({
        ...input,
        modelOptions: selections(["contextWindow", "1m"], ["effort", "low"]),
      }),
    ).toMatchObject({
      promptEffort: "low",
      modelOptionsForDispatch: selections(["contextWindow", "1m"], ["effort", "low"]),
    });
    expect(models[0]?.capabilities?.optionDescriptors?.[0]).toMatchObject({ currentValue: "1m" });
  });

  it("does not invent smaller context levels for a model that only supports 1M", () => {
    expect(
      getComposerProviderState({
        provider: PROVIDER,
        model: MODEL,
        prompt: "",
        modelOptions: undefined,
        models: modelWith([
          selectDescriptor("contextWindow", [{ id: "1m", label: "1M", isDefault: true }]),
        ]),
      }),
    ).toMatchObject({
      promptEffort: null,
      modelOptionsForDispatch: selections(["contextWindow", "1m"]),
    });
  });

  it.each([
    ["unset", undefined, false],
    ["saved On", true, true],
    ["saved Off", false, false],
  ] as const)(
    "dispatches %s Fast independently of a native On default",
    (_label, saved, expected) => {
      const models = modelWith([
        { ...booleanDescriptor("fastMode"), currentValue: true },
        { ...booleanDescriptor("thinking"), currentValue: true },
      ]);
      const state = getComposerProviderState({
        provider: PROVIDER,
        model: MODEL,
        models,
        prompt: "",
        modelOptions: [
          ...(saved === undefined ? [] : selections(["fastMode", saved])),
          ...selections(
            ["thinking", false],
            [CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID, "64"],
            [CODEX_AUTO_DELEGATE_OPTION_ID, false],
          ),
        ],
      });
      expect(state.modelOptionsForDispatch).toEqual(
        selections(
          ["fastMode", expected],
          ["thinking", false],
          [CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID, "64"],
          [CODEX_AUTO_DELEGATE_OPTION_ID, false],
        ),
      );
      expect(models[0]?.capabilities?.optionDescriptors?.[0]).toMatchObject({ currentValue: true });
    },
  );

  it("preserves the explicit automatic delegation off choice beside traits and worker capacity", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([booleanDescriptor("fastMode")]),
      prompt: "",
      modelOptions: selections(
        ["fastMode", true],
        [CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID, "64"],
        [CODEX_AUTO_DELEGATE_OPTION_ID, false],
      ),
    });
    expect(state.modelOptionsForDispatch).toEqual(
      selections(
        ["fastMode", true],
        [CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID, "64"],
        [CODEX_AUTO_DELEGATE_OPTION_ID, false],
      ),
    );
  });
  it.each([
    ["codex", "reasoningEffort"],
    ["claudeAgent", "effort"],
    ["opencode", "variant"],
  ])("defaults %s to High without changing saved choices or catalog metadata", (driver, id) => {
    const models = modelWith([
      selectDescriptor(id, [
        { id: "low", label: "Low", isDefault: true },
        { id: "high", label: "High" },
      ]),
    ]);
    const input = { provider: ProviderDriverKind.make(driver), model: MODEL, models, prompt: "" };
    expect(getComposerProviderState({ ...input, modelOptions: undefined })).toMatchObject({
      promptEffort: "high",
      modelOptionsForDispatch: selections([id, "high"]),
    });
    expect(
      getComposerProviderState({ ...input, modelOptions: selections([id, "low"]) }),
    ).toMatchObject({
      promptEffort: "low",
      modelOptionsForDispatch: selections([id, "low"]),
    });
    expect(models[0]?.capabilities?.optionDescriptors?.[0]).toMatchObject({ currentValue: "low" });
  });

  it("keeps supported defaults when High is unavailable and leaves unrelated selectors alone", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      prompt: "",
      modelOptions: undefined,
      models: modelWith([
        selectDescriptor("effort", [{ id: "medium", label: "Medium", isDefault: true }]),
        selectDescriptor("agent", [
          { id: "normal", label: "Normal", isDefault: true },
          { id: "high", label: "High" },
        ]),
      ]),
    });
    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "medium"], ["agent", "normal"]),
    );
  });

  it("returns descriptor defaults when no selections are provided", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
      ]),
      prompt: "",
      modelOptions: undefined,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "high",
      modelOptionsForDispatch: selections(["effort", "high"]),
    });
  });

  it("lets selections override defaults and propagates them through dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
        booleanDescriptor("fastMode"),
      ]),
      prompt: "",
      modelOptions: selections(["effort", "low"], ["fastMode", true]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "low",
      modelOptionsForDispatch: selections(["effort", "low"], ["fastMode", true]),
    });
  });

  it("preserves selections that match defaults so deepMerge can overwrite prior state", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        booleanDescriptor("fastMode"),
      ]),
      prompt: "",
      modelOptions: selections(["effort", "high"], ["fastMode", false]),
    });

    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["fastMode", false]),
    );
  });

  it("drops selections for descriptors the model does not declare", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([booleanDescriptor("thinking")]),
      prompt: "",
      modelOptions: selections(["effort", "max"], ["thinking", false]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: selections(["thinking", false]),
    });
  });

  it("preserves the reserved thread-bound Codex agent ceiling through descriptor filtering", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([booleanDescriptor("thinking")]),
      prompt: "",
      modelOptions: selections(["thinking", false], [CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID, "64"]),
    });

    expect(state.modelOptionsForDispatch).toEqual(
      selections(["thinking", false], [CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID, "64"]),
    );
  });

  it("leaves an unsaved Codex agent ceiling implicit for the server default", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([]),
      prompt: "",
      modelOptions: undefined,
    });

    expect(state.modelOptionsForDispatch).toBeUndefined();
  });

  it("does not normalize malformed Codex agent ceilings into a different runtime value", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([]),
      prompt: "",
      modelOptions: selections([CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID, " 64 "]),
    });

    expect(state.modelOptionsForDispatch).toBeUndefined();
  });

  it("does not attach the Codex agent ceiling to a Claude thread", () => {
    const state = getComposerProviderState({
      provider: ProviderDriverKind.make("claudeAgent"),
      model: MODEL,
      models: modelWith([]),
      prompt: "",
      modelOptions: selections([CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID, "64"]),
    });

    expect(state.modelOptionsForDispatch).toBeUndefined();
  });

  it("derives promptEffort from the first select descriptor and preserves all others for dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        selectDescriptor("contextWindow", [
          { id: "200k", label: "200k", isDefault: true },
          { id: "1m", label: "1M" },
        ]),
        selectDescriptor("agent", [
          { id: "build", label: "Build", isDefault: true },
          { id: "plan", label: "Plan" },
        ]),
      ]),
      prompt: "",
      modelOptions: selections(["agent", "plan"]),
    });

    expect(state.promptEffort).toBe("high");
    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["contextWindow", "200k"], ["agent", "plan"]),
    );
  });

  it("returns undefined dispatch options when the model declares no descriptors", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([]),
      prompt: "",
      modelOptions: selections(["anything", "value"]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: undefined,
    });
  });

  it("adds ultrathink class names when the prompt triggers a promptInjectedValues descriptor", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor(
          "effort",
          [
            { id: "medium", label: "Medium" },
            { id: "high", label: "High", isDefault: true },
            { id: "ultrathink", label: "Ultrathink" },
          ],
          ["ultrathink"],
        ),
      ]),
      prompt: "Ultrathink:\nInvestigate this failure",
      modelOptions: selections(["effort", "medium"]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "medium",
      modelOptionsForDispatch: selections(["effort", "medium"]),
      ...ULTRATHINK_FRAME_CLASSES,
    });
  });

  it("does not add ultrathink class names when the descriptor has no promptInjectedValues", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
      ]),
      prompt: "Ultrathink:\nInvestigate this failure",
      modelOptions: undefined,
    });

    expect(state).not.toHaveProperty("composerFrameClassName");
    expect(state).not.toHaveProperty("composerSurfaceClassName");
    expect(state).not.toHaveProperty("modelPickerIconClassName");
  });
});

describe("provider traits render guards", () => {
  it("returns null when no thread target is provided", () => {
    const models = modelWith([
      selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
    ]);
    const args = {
      provider: PROVIDER,
      providerInstanceId: PROVIDER_INSTANCE,
      model: MODEL,
      models,
      modelOptions: undefined,
      prompt: "",
      onPromptChange: () => {},
    };

    expect(renderProviderTraitsPicker(args)).toBeNull();
    expect(renderProviderTraitsMenuContent(args)).toBeNull();
  });
});
