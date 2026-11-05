import "../../index.css";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@cafecode/contracts";
import type { DraftId } from "../../composerDraftStore";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { ComposerFastMode } from "./ComposerFastMode";
import { ThreadAgentControl } from "./ThreadAgentControl";
import { TraitsMenuContent, TraitsPicker } from "./TraitsPicker";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../composerDraftStore", async () => {
  const Schema = await import("effect/Schema");
  return {
    DraftId: Schema.String.pipe(Schema.brand("DraftId")),
    useComposerDraftStore: (
      selector: (state: { setProviderModelOptions: typeof mocks.save }) => unknown,
    ) => selector({ setProviderModelOptions: mocks.save }),
  };
});
afterEach(() => {
  cleanup();
  mocks.save.mockClear();
});
const props = {
  provider: ProviderDriverKind.make("codex"),
  providerInstanceId: ProviderInstanceId.make("codex_custom"),
  model: "synthetic",
  threadTarget: "draft-control-preview" as DraftId,
};
const models: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "synthetic",
    name: "Synthetic",
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: true },
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "high", label: "High" },
            { id: "low", label: "Low" },
          ],
          currentValue: "high",
        },
      ],
    },
  },
];
const options: ReadonlyArray<ProviderOptionSelection> = [
  { id: "codexSubagentThreadLimit", value: "64" },
  { id: "codexAutoDelegate", value: false },
];

it("exposes Fast only for capable models and saves the exact provider instance without losing worker controls", async () => {
  const screen = await render(
    <ComposerFastMode {...props} models={models} modelOptions={options} />,
  );
  await expect
    .element(page.getByRole("button", { name: "Fast mode: Off" }))
    .toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Fast mode: Off" }).click();
  expect(mocks.save).toHaveBeenLastCalledWith(
    props.threadTarget,
    props.provider,
    [...options, { id: "fastMode", value: true }],
    { instanceId: props.providerInstanceId, model: props.model, persistSticky: true },
  );
  await screen.rerender(
    <ComposerFastMode
      {...props}
      models={models}
      modelOptions={[...options, { id: "fastMode", value: true }]}
    />,
  );
  await page.getByRole("button", { name: "Fast mode: On" }).click();
  expect(mocks.save.mock.calls.at(-1)?.[2]).toContainEqual({ id: "fastMode", value: false });
  await screen.rerender(
    <ComposerFastMode
      {...props}
      models={models}
      modelOptions={[...options, { id: "fastMode", value: false }]}
    />,
  );
  await expect
    .element(page.getByRole("button", { name: "Fast mode: Off" }))
    .toHaveAttribute("aria-pressed", "false");
  await screen.rerender(<ComposerFastMode {...props} models={[]} modelOptions={options} />);
  await expect.element(page.getByRole("button", { name: /Fast mode:/ })).not.toBeInTheDocument();
});

it("shows Fast Off in model traits until an explicit saved On choice", async () => {
  const traitProps = {
    provider: props.provider,
    models,
    model: props.model,
    prompt: "",
    onPromptChange: vi.fn(),
    onModelOptionsChange: vi.fn(),
  };
  const screen = await render(<TraitsPicker {...traitProps} modelOptions={undefined} />);
  await expect.element(page.getByRole("button", { name: /Fast Off/ })).toBeVisible();
  await screen.rerender(
    <TraitsPicker {...traitProps} modelOptions={[{ id: "fastMode", value: true }]} />,
  );
  await expect.element(page.getByRole("button", { name: /Fast On/ })).toBeVisible();
  await screen.rerender(
    <TraitsPicker {...traitProps} modelOptions={[{ id: "fastMode", value: false }]} />,
  );
  await expect.element(page.getByRole("button", { name: /Fast Off/ })).toBeVisible();
});

it("keeps worker controls when changing model traits", async () => {
  const changed = vi.fn();
  await render(
    <Menu open>
      <MenuTrigger>Traits</MenuTrigger>
      <MenuPopup>
        <TraitsMenuContent
          provider={props.provider}
          models={models}
          model={props.model}
          prompt=""
          onPromptChange={vi.fn()}
          modelOptions={options}
          onModelOptionsChange={changed}
        />
      </MenuPopup>
    </Menu>,
  );
  await page.getByRole("menuitemradio", { name: "Low", exact: true }).click();
  await expect
    .element(page.getByRole("menuitemradio", { name: "Off", exact: true }))
    .toHaveAttribute("aria-checked", "true");
  expect(changed.mock.calls.at(-1)?.[0]).toEqual(
    expect.arrayContaining([...options, { id: "reasoningEffort", value: "low" }]),
  );
});

it("shows automatic delegation separately from the 16-worker ceiling and persists opt-out on the exact thread", async () => {
  const persist = vi.fn();
  await render(
    <ThreadAgentControl {...props} modelOptions={undefined} onPersistModelSelection={persist} />,
  );
  await page.getByRole("button", { name: /Codex workers for this thread: 16/ }).click();
  const auto = page.getByRole("checkbox", { name: "Delegate independent work automatically" });
  await expect.element(auto).toBeChecked();
  await auto.click();
  expect(mocks.save.mock.calls.at(-1)?.[3]).toEqual({
    instanceId: props.providerInstanceId,
    model: props.model,
    persistSticky: false,
  });
  expect(persist.mock.calls.at(-1)?.[0].options).toContainEqual({
    id: "codexAutoDelegate",
    value: false,
  });
});

it("keeps Fast visible and the worker popup inside mobile and desktop viewports", async () => {
  for (const width of [375, 1200]) {
    await page.viewport(width, 800);
    const screen = await render(
      <main data-testid="preview" className="bg-background p-4 text-foreground">
        <div className="flex flex-wrap items-center gap-1">
          <ThreadAgentControl {...props} modelOptions={undefined} />
          <ComposerFastMode {...props} models={models} modelOptions={undefined} />
        </div>
      </main>,
    );
    await expect.element(page.getByRole("button", { name: "Fast mode: Off" })).toBeVisible();
    await page.getByRole("button", { name: /Codex workers for this thread: 16/ }).click();
    const popup = page
      .getByText("Codex workers for this thread", { exact: true })
      .element()
      .closest('[data-slot="popover-popup"]')!;
    expect(popup.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    expect(popup.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    const content = popup.querySelector('[data-thread-agent-settings="true"]')!;
    expect(content.getBoundingClientRect().right).toBeLessThanOrEqual(
      popup.getBoundingClientRect().right - 12,
    );
    expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth + 1);
    await page.screenshot({
      path: `./__screenshots__/agent-fast-controls-${width}.png`,
    });
    await screen.unmount();
  }
});
