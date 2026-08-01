import "../../index.css";

import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { CoworkInvitationRedemptionPanel } from "../../cowork/CoworkInvitationRedemptionPanel.tsx";
import type {
  CoworkInvitationRedemptionClient,
  CoworkInvitationRedemptionIdentity,
} from "../../cowork/invitationRedemptionPanel.ts";

const IDENTITY = Object.freeze({
  sessionId: "browser-pre-member-session",
  userId: "browser-joining-user",
  deviceId: "browser-joining-device",
  issuedAt: "2026-08-01T12:00:00.000Z",
  expiresAt: "2026-08-01T12:30:00.000Z",
} satisfies CoworkInvitationRedemptionIdentity);
const TOKEN = "B".repeat(43);

type Mounted = Awaited<ReturnType<typeof render>>;
let mounted: Mounted | null = null;

function redemptionResult(disposition: "applied" | "already-applied" = "applied") {
  return {
    disposition,
    member: {
      userId: IDENTITY.userId,
      displayName: "Browser Operator",
      role: "viewer",
      permissions: ["transcript.read", "chat.read", "task.read", "file.read"],
      joinedAt: "2026-08-01T12:05:00.000Z",
    },
    membershipEpoch: 5,
  };
}

async function fillForm() {
  await page.getByLabelText("Shared project ID").fill("browser-shared-project");
  await page.getByLabelText("One-time invitation token").fill(TOKEN);
  await page.getByLabelText("Display name").fill("Browser Operator");
}

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("CoworkInvitationRedemptionPanel", () => {
  it("renders nothing and performs no work without an injected client", async () => {
    mounted = await render(<CoworkInvitationRedemptionPanel client={null} identity={IDENTITY} />);

    await expect
      .element(page.getByRole("heading", { name: "Join shared project" }))
      .not.toBeInTheDocument();
    expect(document.body.textContent?.trim()).toBe("");
  });

  it("submits explicit fields, removes the token from the DOM, and renders bounded success", async () => {
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(async () =>
      redemptionResult(),
    );
    mounted = await render(
      <CoworkInvitationRedemptionPanel
        client={{ redeemInvitation }}
        identity={IDENTITY}
        createCommandId={() => "browser-redeem-command"}
      />,
    );
    await expect.element(page.getByRole("status")).toHaveTextContent("Ready to redeem");

    await fillForm();
    await page.getByRole("button", { name: "Redeem invitation" }).click();

    await expect.element(page.getByRole("status")).toHaveTextContent("Invitation redeemed");
    await expect
      .element(page.getByRole("group", { name: "Joined project membership" }))
      .toHaveTextContent("Browser Operator");
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(redeemInvitation).toHaveBeenCalledWith({
      identity: IDENTITY,
      request: {
        commandId: "browser-redeem-command",
        sharedProjectId: "browser-shared-project",
        secret: TOKEN,
        displayName: "Browser Operator",
      },
    });
  });

  it("keeps an indeterminate request out of the form and retries the exact command", async () => {
    const redeemInvitation = vi
      .fn<CoworkInvitationRedemptionClient["redeemInvitation"]>()
      .mockRejectedValueOnce(new Error("lost acknowledgement"))
      .mockResolvedValueOnce(redemptionResult("already-applied"));
    const createCommandId = vi.fn(() => "browser-retry-command");
    mounted = await render(
      <CoworkInvitationRedemptionPanel
        client={{ redeemInvitation }}
        identity={IDENTITY}
        createCommandId={createCommandId}
      />,
    );

    await fillForm();
    await page.getByRole("button", { name: "Redeem invitation" }).click();
    await expect
      .element(page.getByRole("group", { name: "Indeterminate redemption recovery" }))
      .toBeVisible();
    await expect.element(page.getByLabelText("One-time invitation token")).toHaveValue("");
    await expect.element(page.getByLabelText("One-time invitation token")).toBeDisabled();
    expect(document.body.textContent).not.toContain(TOKEN);

    await page.getByRole("button", { name: "Retry exact redemption command" }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("Invitation redeemed");
    expect(redeemInvitation.mock.calls[1]![0]).toBe(redeemInvitation.mock.calls[0]![0]);
    expect(createCommandId).toHaveBeenCalledTimes(1);
  });

  it("clears a typed token when the explicit project changes", async () => {
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(async () =>
      redemptionResult(),
    );
    mounted = await render(
      <CoworkInvitationRedemptionPanel client={{ redeemInvitation }} identity={IDENTITY} />,
    );

    await page.getByLabelText("One-time invitation token").fill(TOKEN);
    await page.getByLabelText("Shared project ID").fill("different-project");

    await expect.element(page.getByLabelText("One-time invitation token")).toHaveValue("");
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("clears the form token after a definitive rejected result", async () => {
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(
      async () => ({ ...redemptionResult(), sharedProjectId: "forbidden-excess-field" }),
    );
    mounted = await render(
      <CoworkInvitationRedemptionPanel client={{ redeemInvitation }} identity={IDENTITY} />,
    );
    await fillForm();

    await page.getByRole("button", { name: "Redeem invitation" }).click();

    await expect.element(page.getByRole("status")).toHaveTextContent("was rejected");
    await expect.element(page.getByLabelText("One-time invitation token")).toHaveValue("");
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("clears an unsubmitted token on client replacement and unmount", async () => {
    const firstClient: CoworkInvitationRedemptionClient = {
      redeemInvitation: vi.fn(async () => redemptionResult()),
    };
    mounted = await render(
      <CoworkInvitationRedemptionPanel client={firstClient} identity={IDENTITY} />,
    );
    await page.getByLabelText("One-time invitation token").fill(TOKEN);

    const replacementClient: CoworkInvitationRedemptionClient = {
      redeemInvitation: vi.fn(async () => redemptionResult()),
    };
    await mounted.rerender(
      <CoworkInvitationRedemptionPanel client={replacementClient} identity={IDENTITY} />,
    );
    await expect.element(page.getByLabelText("One-time invitation token")).toHaveValue("");
    expect(document.body.textContent).not.toContain(TOKEN);

    await page.getByLabelText("One-time invitation token").fill(TOKEN);
    await mounted.unmount();
    mounted = null;
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("discards the retry capability before allowing a new scope", async () => {
    const redeemInvitation = vi.fn<CoworkInvitationRedemptionClient["redeemInvitation"]>(async () =>
      Promise.reject(new Error("lost acknowledgement")),
    );
    mounted = await render(
      <CoworkInvitationRedemptionPanel client={{ redeemInvitation }} identity={IDENTITY} />,
    );
    await fillForm();
    await page.getByRole("button", { name: "Redeem invitation" }).click();
    await expect
      .element(page.getByRole("button", { name: "Discard retry capability" }))
      .toBeVisible();

    await page.getByRole("button", { name: "Discard retry capability" }).click();

    await expect.element(page.getByLabelText("Shared project ID")).toHaveValue("");
    await expect.element(page.getByLabelText("Display name")).toHaveValue("");
    await expect.element(page.getByRole("button", { name: "Redeem invitation" })).toBeEnabled();
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("clears context and ignores late results after authenticated identity replacement", async () => {
    let resolveLate!: (value: unknown) => void;
    const firstClient: CoworkInvitationRedemptionClient = {
      redeemInvitation: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveLate = resolve;
          }),
      ),
    };
    mounted = await render(
      <StrictMode>
        <CoworkInvitationRedemptionPanel client={firstClient} identity={IDENTITY} />
      </StrictMode>,
    );
    await fillForm();
    await page.getByRole("button", { name: "Redeem invitation" }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("Redeeming invitation");

    const replacementIdentity = Object.freeze({
      ...IDENTITY,
      sessionId: "replacement-session",
      deviceId: "replacement-device",
    });
    const replacementClient: CoworkInvitationRedemptionClient = {
      redeemInvitation: vi.fn(async () => redemptionResult()),
    };
    await mounted.rerender(
      <StrictMode>
        <CoworkInvitationRedemptionPanel
          client={replacementClient}
          identity={replacementIdentity}
        />
      </StrictMode>,
    );
    resolveLate(redemptionResult());

    await expect.element(page.getByRole("status")).toHaveTextContent("Ready to redeem");
    await expect.element(page.getByLabelText("Shared project ID")).toHaveValue("");
    await expect.element(page.getByLabelText("One-time invitation token")).toHaveValue("");
    await expect
      .element(page.getByRole("group", { name: "Joined project membership" }))
      .not.toBeInTheDocument();
  });
});
