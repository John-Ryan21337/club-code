import "../index.css";
import { DEFAULT_CLIENT_SETTINGS, DEFAULT_SERVER_SETTINGS } from "@cafecode/contracts";
import type { ClientSettings } from "@cafecode/contracts/settings";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { UiText, useUiLocalization } from "../uiLocalization";
import { SettingsUiLocalizationProvider as UiLocalizationProvider } from "./SettingsUiLocalizationProvider";
import { createPortal } from "react-dom";
import { InterfaceLanguageSettings } from "./settings/InterfaceLanguageSettings";
import {
  __resetClientSettingsPersistenceForTests,
  getClientSettings,
  useUpdateSettings,
} from "../hooks/useSettings";
import {
  replaceClientSettingsSnapshot,
  setClientSettingsHydrated,
} from "../hooks/clientSettingsState";

const fixture = vi.hoisted(() => ({
  getPersisted: vi.fn(),
  setPersisted: vi.fn(),
  updateShared: vi.fn(),
}));
const serverConfig = { clientSettings: { ...DEFAULT_CLIENT_SETTINGS, uiLanguage: "ja" as const } };
vi.mock("../localApi", () => ({
  ensureLocalApi: () => ({
    persistence: {
      getClientSettings: fixture.getPersisted,
      setClientSettings: fixture.setPersisted,
    },
    server: { updateClientSettings: fixture.updateShared },
  }),
}));
vi.mock("../rpc/serverState", () => ({
  getServerConfig: () => serverConfig,
  useServerConfig: () => serverConfig,
  useServerSettings: () => DEFAULT_SERVER_SETTINGS,
  applyClientSettingsUpdated: vi.fn(),
  applySettingsUpdated: vi.fn(),
}));

beforeEach(() => {
  __resetClientSettingsPersistenceForTests();
  fixture.getPersisted
    .mockReset()
    .mockResolvedValue({ ...DEFAULT_CLIENT_SETTINGS, uiLanguage: "en" });
  fixture.setPersisted.mockReset().mockResolvedValue(undefined);
  fixture.updateShared.mockReset().mockResolvedValue(undefined);
});

it("changes language through the real control and saves only this renderer's preference", async () => {
  await render(
    <div id="root">
      <UiLocalizationProvider>
        <InterfaceLanguageSettings />
      </UiLocalizationProvider>
    </div>,
  );
  await expect.poll(() => document.documentElement.dataset.uiLanguage).toBe("en");
  expect(getClientSettings().uiLanguage).toBe("en");
  await page.getByRole("combobox", { name: "Interface language", exact: true }).click();
  await page.getByRole("option", { name: "English + 日本語", exact: true }).click();
  await expect
    .element(page.getByText("Interface language / インターフェース言語", { exact: true }))
    .toBeVisible();
  await expect.poll(() => fixture.setPersisted.mock.calls.at(-1)?.[0]?.uiLanguage).toBe("dual");
  expect(fixture.updateShared).not.toHaveBeenCalled();
  expect(serverConfig.clientSettings.uiLanguage).toBe("ja");
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "日本語", exact: true }).click();
  await expect.element(page.getByText("インターフェース言語", { exact: true })).toBeVisible();
  expect(document.documentElement.lang).toBe("ja");
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect.element(page.getByText("Interface language", { exact: true })).toBeVisible();
});

function ExplicitLabelsFixture() {
  const [label, setLabel] = useState("Settings");
  const { t } = useUiLocalization();
  const { updateSettings } = useUpdateSettings();
  return (
    <>
      <button
        aria-label={t("Save")}
        title={t("Save")}
        onClick={() => setLabel("Authored replacement")}
      >
        {label === "Settings" ? <UiText english="Settings" /> : label}
      </button>
      <button data-no-ui-localize="true" onClick={() => updateSettings({ uiLanguage: "en" })}>
        English mode
      </button>
      <div data-message-id="synthetic-message">Settings</div>
      <div data-chat-copy-region="assistant">Delete</div>
      <pre title="Settings">Save</pre>
      <div contentEditable suppressContentEditableWarning>
        Delete
      </div>
      <input defaultValue="Settings" aria-label="Synthetic input" />
      <span data-testid="unmarked-authored-label" title="Settings">
        Settings
      </span>
      <div className="xterm">Settings</div>
      <div className="chat-markdown">Delete</div>
      {createPortal(
        <button title={t("Delete")}>
          <UiText english="Delete" />
        </button>,
        document.body,
      )}
    </>
  );
}

it("translates known chrome while preserving transcript, editor, terminal, and authored labels", async () => {
  replaceClientSettingsSnapshot({ ...DEFAULT_CLIENT_SETTINGS, uiLanguage: "ja" });
  setClientSettingsHydrated(true);
  await render(
    <div id="root">
      <UiLocalizationProvider>
        <ExplicitLabelsFixture />
      </UiLocalizationProvider>
    </div>,
  );
  await expect
    .element(page.getByRole("button", { name: "保存", exact: true }))
    .toHaveTextContent("設定");
  expect(document.querySelector("[data-message-id]")?.textContent).toBe("Settings");
  expect(document.querySelector("[data-chat-copy-region]")?.textContent).toBe("Delete");
  expect(document.querySelector("pre")?.textContent).toBe("Save");
  expect(document.querySelector("pre")?.title).toBe("Settings");
  expect(document.querySelector("[contenteditable]")?.textContent).toBe("Delete");
  expect(document.querySelector("input")?.value).toBe("Settings");
  expect(document.querySelector('[data-testid="unmarked-authored-label"]')?.textContent).toBe(
    "Settings",
  );
  expect(
    document.querySelector('[data-testid="unmarked-authored-label"]')?.getAttribute("title"),
  ).toBe("Settings");
  await expect
    .element(page.getByRole("button", { name: "削除", exact: true }))
    .toHaveAttribute("title", "削除");
  expect(document.querySelector(".xterm")?.textContent).toBe("Settings");
  expect(document.querySelector(".chat-markdown")?.textContent).toBe("Delete");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.element(page.getByText("Authored replacement", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "English mode", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Save", exact: true }))
    .toHaveTextContent("Authored replacement");
});

it("waits for local hydration before writing without replacing other saved preferences", async () => {
  let finish!: (settings: ClientSettings) => void;
  fixture.getPersisted.mockReturnValue(
    new Promise<ClientSettings>((resolve) => {
      finish = resolve;
    }),
  );
  function PendingWrite() {
    const { updateSettings } = useUpdateSettings();
    return <button onClick={() => updateSettings({ uiLanguage: "dual" })}>Choose bilingual</button>;
  }
  await render(
    <div id="root">
      <UiLocalizationProvider>
        <PendingWrite />
      </UiLocalizationProvider>
    </div>,
  );
  await page.getByRole("button", { name: "Choose bilingual" }).click();
  expect(fixture.setPersisted).not.toHaveBeenCalled();
  finish({ ...DEFAULT_CLIENT_SETTINGS, uiLanguage: "en", interfaceScalePercent: 125 });
  await expect
    .poll(() => fixture.setPersisted.mock.calls.at(-1)?.[0])
    .toMatchObject({ uiLanguage: "dual", interfaceScalePercent: 125 });
  expect(
    fixture.updateShared.mock.calls.every(([patch]) => !Object.hasOwn(patch, "uiLanguage")),
  ).toBe(true);
});
