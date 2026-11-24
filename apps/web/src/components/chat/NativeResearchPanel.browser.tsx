import "../../index.css";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { EnvironmentId, type ResearchJob } from "@cafecode/contracts";
import { researchRequest } from "../../researchApi";
import { NativeResearchPanel, type NativeResearchHandle } from "./NativeResearchPanel";

vi.mock("../../researchApi", () => ({ researchRequest: vi.fn() }));
vi.mock("../../uiLocalization", () => ({
  useUiLocalization: () => ({ t: (english: string) => english }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const environmentId = EnvironmentId.make("test-env");

it("opens clarification without starting a paid run, then sends the reviewed scope", async () => {
  const ref = createRef<NativeResearchHandle>();
  let job: ResearchJob | undefined;
  vi.mocked(researchRequest).mockImplementation(async (_environment, action) => {
    if (action.action === "prepare")
      job = {
        id: action.id,
        scope: action.scope,
        prompt: action.prompt,
        status: "draft",
        createdAt: new Date().toISOString(),
      };
    if (action.action === "start") job = { ...job!, status: "queued" };
    return { configured: true, jobs: job ? [job] : [] };
  });
  await render(<NativeResearchPanel environmentId={environmentId} scope="thread" ref={ref} />);
  await ref.current!.prepare("Compare battery research");
  await expect.element(page.getByRole("dialog")).toBeVisible();
  expect(
    vi.mocked(researchRequest).mock.calls.some(([, action]) => action.action === "start"),
  ).toBe(false);
  await page
    .getByRole("textbox", { name: "What should the research cover or exclude? Which location?" })
    .fill("Public research in Japan");
  await page.getByRole("textbox", { name: "Which time period matters?" }).fill("2024–2026");
  if (import.meta.env.VITE_CAPTURE_RESEARCH === "1") {
    await page.viewport(1100, 950);
    await page.screenshot({
      path: "../../../../../docs/pr-assets/research/review-desktop.png",
      save: true,
    });
    await page.viewport(390, 844);
    const dialog = page.getByRole("dialog").element().getBoundingClientRect();
    expect(dialog.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: "../../../../../docs/pr-assets/research/review-mobile.png",
      save: true,
    });
  }
  await page.getByRole("button", { name: "Start paid API research" }).click();
  await expect.element(page.getByRole("button", { name: "Cancel research" })).toBeVisible();
  expect(researchRequest).toHaveBeenCalledWith(
    environmentId,
    expect.objectContaining({
      action: "start",
      scope: "Public research in Japan",
      period: "2024–2026",
      model: "o4-mini-deep-research",
      maxToolCalls: 25,
    }),
  );
});

it("shows setup and clears the password field after saving", async () => {
  const ref = createRef<NativeResearchHandle>();
  vi.mocked(researchRequest).mockImplementation(async (_environment, action) => ({
    configured: action.action === "configure",
    jobs: [],
  }));
  await render(<NativeResearchPanel environmentId={environmentId} scope="thread" ref={ref} />);
  ref.current!.open();
  const input = page.getByLabelText("OpenAI API key", { exact: true });
  await input.fill("sk-fixture-not-a-real-key");
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect.element(input).toHaveValue("");
  expect(researchRequest).toHaveBeenCalledWith(environmentId, {
    action: "configure",
    key: "sk-fixture-not-a-real-key",
  });
});

it("recovers an uncertain saved response through a status check", async () => {
  const ref = createRef<NativeResearchHandle>();
  const job: ResearchJob = {
    id: "saved-run",
    scope: "thread",
    prompt: "An earlier research run",
    status: "unknown",
    responseId: "resp_saved",
    createdAt: new Date().toISOString(),
  };
  vi.mocked(researchRequest).mockImplementation(async (_environment, action) => ({
    configured: true,
    jobs: [{ ...job, status: action.action === "poll" ? "completed" : "unknown" }],
  }));
  await render(<NativeResearchPanel environmentId={environmentId} scope="thread" ref={ref} />);
  ref.current!.open();
  await page.getByRole("combobox", { name: "Saved research" }).selectOptions(job.id);
  await page.getByRole("button", { name: "Check saved run status" }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("completed");
  expect(researchRequest).toHaveBeenCalledWith(environmentId, { action: "poll", id: job.id });
  expect(
    vi.mocked(researchRequest).mock.calls.some(([, action]) => action.action === "start"),
  ).toBe(false);
});

it("can save a draft when the browser does not expose crypto.randomUUID", async () => {
  const ref = createRef<NativeResearchHandle>();
  vi.mocked(researchRequest).mockResolvedValue({ configured: false, jobs: [] });
  await render(<NativeResearchPanel environmentId={environmentId} scope="thread" ref={ref} />);
  const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  try {
    await ref.current!.prepare("Public research topic");
  } finally {
    if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
    else Reflect.deleteProperty(crypto, "randomUUID");
  }
  expect(researchRequest).toHaveBeenCalledWith(
    environmentId,
    expect.objectContaining({
      action: "prepare",
      id: expect.stringMatching(/^[a-f0-9-]{36}$/),
    }),
  );
});
