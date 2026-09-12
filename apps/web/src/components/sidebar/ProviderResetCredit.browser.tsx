import "../../index.css";
import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@cafecode/contracts";
import { ProviderResetCredit } from "./ProviderResetCredit";
const harness = vi.hoisted(() => ({ consume: vi.fn(), connection: {} as object }));
vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => harness.connection,
}));
const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("synthetic-codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "synthetic",
  status: "ready",
  auth: { status: "authenticated", type: "chatgpt", email: "synthetic@example.invalid" },
  checkedAt: new Date().toISOString(),
  models: [],
  slashCommands: [],
  skills: [],
  runtimeCapabilities: { liveSteer: "supported", threadGoals: "supported", resetCredit: true },
  accountRateLimits: {
    checkedAt: new Date().toISOString(),
    rateLimits: {},
    rateLimitResetCredits: {
      availableCount: 1,
      credits: [
        { id: "synthetic-credit", status: "available", resetType: "codexRateLimits", grantedAt: 1 },
      ],
    },
  },
};
beforeEach(() => {
  harness.consume.mockReset().mockResolvedValue("reset");
  harness.connection = { client: { server: { consumeResetCredit: harness.consume } } };
});
it("requires confirmation and sends one exact credit with a UUID attempt", async () => {
  const screen = await render(<ProviderResetCredit provider={provider} stale={false} />);
  expect(harness.consume).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Use one reset credit", exact: true }).click();
  expect(harness.consume).not.toHaveBeenCalled();
  await expect.element(screen.getByText(/synthetic@example.invalid/)).toBeVisible();
  await screen.getByRole("button", { name: "Confirm use of one credit" }).click();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("The provider reset the usage limit.");
  expect(harness.consume).toHaveBeenCalledOnce();
  expect(harness.consume.mock.calls[0]?.[0]).toMatchObject({
    instanceId: provider.instanceId,
    expectedEmail: provider.auth.email,
    creditId: "synthetic-credit",
    attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  await expect
    .element(screen.getByRole("button", { name: "Use one reset credit", exact: true }))
    .toBeDisabled();
});
it("cancels without calling the provider", async () => {
  const screen = await render(<ProviderResetCredit provider={provider} stale={false} />);
  await screen.getByRole("button", { name: "Use one reset credit", exact: true }).click();
  await screen.getByRole("button", { name: "Cancel" }).click();
  expect(harness.consume).not.toHaveBeenCalled();
});
it("does not reuse confirmation after changing the primary environment", async () => {
  const screen = await render(<ProviderResetCredit provider={provider} stale={false} />);
  await screen.getByRole("button", { name: "Use one reset credit", exact: true }).click();
  harness.connection = { client: { server: { consumeResetCredit: vi.fn() } } };
  await screen.getByRole("button", { name: "Confirm use of one credit" }).click();
  expect(harness.consume).not.toHaveBeenCalled();
});
it("keeps an ambiguous failure fixed and does not retry", async () => {
  harness.consume.mockRejectedValue(new Error("synthetic private provider failure"));
  const screen = await render(<ProviderResetCredit provider={provider} stale={false} />);
  await screen.getByRole("button", { name: "Use one reset credit", exact: true }).click();
  await screen.getByRole("button", { name: "Confirm use of one credit" }).click();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("The reset result is unknown.");
  expect(document.body.textContent).not.toContain("synthetic private");
  expect(harness.consume).toHaveBeenCalledOnce();
});
it("hides the action when credit metadata is stale", async () => {
  const screen = await render(<ProviderResetCredit provider={provider} stale />);
  await expect
    .element(screen.getByRole("button", { name: "Use one reset credit", exact: true }))
    .not.toBeInTheDocument();
  expect(harness.consume).not.toHaveBeenCalled();
});

it("clears confirmation when the shown account changes", async () => {
  const screen = await render(<ProviderResetCredit provider={provider} stale={false} />);
  await screen.getByRole("button", { name: "Use one reset credit", exact: true }).click();
  await screen.rerender(
    <ProviderResetCredit
      provider={{ ...provider, auth: { ...provider.auth, email: "other@example.invalid" } }}
      stale={false}
    />,
  );
  await expect
    .element(screen.getByRole("button", { name: "Confirm use of one credit" }))
    .not.toBeInTheDocument();
  expect(harness.consume).not.toHaveBeenCalled();
});

it("does not show expired or unknown reset types as spendable credits", async () => {
  const credits = provider.accountRateLimits!.rateLimitResetCredits!.credits!;
  for (const credit of [
    { ...credits[0]!, expiresAt: 1 },
    { ...credits[0]!, resetType: "unknown" as const },
  ]) {
    const screen = await render(
      <ProviderResetCredit
        provider={{
          ...provider,
          accountRateLimits: {
            ...provider.accountRateLimits!,
            rateLimitResetCredits: { availableCount: 1, credits: [credit] },
          },
        }}
        stale={false}
      />,
    );
    await expect
      .element(screen.getByRole("button", { name: "Use one reset credit", exact: true }))
      .not.toBeInTheDocument();
    await screen.unmount();
  }
  expect(harness.consume).not.toHaveBeenCalled();
});

it("admits only one click while a reset is pending", async () => {
  let resolve!: (outcome: string) => void;
  harness.consume.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const screen = await render(<ProviderResetCredit provider={provider} stale={false} />);
  await screen.getByRole("button", { name: "Use one reset credit", exact: true }).click();
  const confirmation = screen.getByRole("button", { name: "Confirm use of one credit" }).element();
  if (!(confirmation instanceof HTMLButtonElement)) throw new Error("Missing confirm button");
  confirmation.click();
  confirmation.click();
  await expect.poll(() => harness.consume.mock.calls.length).toBe(1);
  await expect.element(screen.getByRole("button", { name: "Using reset credit…" })).toBeDisabled();
  resolve("reset");
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("The provider reset the usage limit.");
  expect(harness.consume).toHaveBeenCalledOnce();
});

it("does not show an old reset result after the displayed account changes", async () => {
  let resolve!: (outcome: string) => void;
  harness.consume.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const screen = await render(<ProviderResetCredit provider={provider} stale={false} />);
  await screen.getByRole("button", { name: "Use one reset credit", exact: true }).click();
  await screen.getByRole("button", { name: "Confirm use of one credit" }).click();
  await screen.rerender(
    <ProviderResetCredit
      provider={{ ...provider, auth: { ...provider.auth, email: "new@example.invalid" } }}
      stale={false}
    />,
  );
  resolve("reset");
  await expect
    .element(screen.getByRole("button", { name: "Use one reset credit", exact: true }))
    .toBeEnabled();
  await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  expect(harness.consume).toHaveBeenCalledOnce();
  expect(harness.consume.mock.calls[0]?.[0].expectedEmail).toBe(provider.auth.email);
});
