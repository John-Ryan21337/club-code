import "../../index.css";

import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { FollowUpQueueShelf } from "./ChatComposer";

describe("FollowUpQueueShelf", () => {
  it("renders queue controls and expands bounded prompt details", async () => {
    const onToggleExpanded = vi.fn();
    const onAction = vi.fn();
    const onRemove = vi.fn();
    const onClear = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <FollowUpQueueShelf
        items={[
          {
            id: "queued-1",
            preview: "Short preview",
            promptText: "Full queued prompt\nwith details",
            images: [],
            queuedAt: "2026-05-22T00:00:00.000Z",
            expanded: true,
            canExpand: true,
            blockedReason: null,
          },
        ]}
        actionLabel="Send"
        actionTitle="Club Code will send this follow-up as soon as the active turn can accept it."
        actionEnabled={true}
        onToggleExpanded={onToggleExpanded}
        onAction={onAction}
        onRemove={onRemove}
        onClear={onClear}
        onExpandImage={vi.fn()}
      />,
      { container: host },
    );

    try {
      expect(document.body.textContent ?? "").toContain("1 message queued");
      expect(document.body.textContent ?? "").toContain("Send");
      expect(document.body.textContent ?? "").toContain("Full queued prompt");
      await expect.element(page.getByLabelText("Queued message prompt")).toBeInTheDocument();

      await page.getByText("Send").click();
      expect(onAction).toHaveBeenCalledWith("queued-1");

      await page.getByLabelText("Remove queued message").click();
      expect(onRemove).toHaveBeenCalledWith("queued-1");

      await page.getByText("Clear").click();
      expect(onClear).toHaveBeenCalledOnce();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("does not expose expansion for prompts that fit in the collapsed row", async () => {
    const onToggleExpanded = vi.fn();
    const onAction = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <FollowUpQueueShelf
        items={[
          {
            id: "queued-short",
            preview: "say yes",
            promptText: "say yes",
            images: [],
            queuedAt: "2026-05-22T00:00:00.000Z",
            expanded: true,
            canExpand: false,
            blockedReason: null,
          },
        ]}
        actionLabel="Send"
        actionTitle="Club Code will send this follow-up as soon as the active turn can accept it."
        actionEnabled={true}
        onToggleExpanded={onToggleExpanded}
        onAction={onAction}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        onExpandImage={vi.fn()}
      />,
      { container: host },
    );

    try {
      await expect.element(page.getByText("say yes", { exact: true })).toBeInTheDocument();
      await expect.element(page.getByLabelText("Expand queued message")).not.toBeInTheDocument();

      await page.getByText("say yes", { exact: true }).click();
      expect(onToggleExpanded).not.toHaveBeenCalled();
      expect((document.body.textContent ?? "").match(/say yes/g)).toHaveLength(1);

      await page.getByText("Send").click();
      expect(onAction).toHaveBeenCalledWith("queued-short");
      await expect
        .element(page.getByRole("button", { name: "Send" }))
        .toHaveAttribute(
          "title",
          "Club Code will send this follow-up as soon as the active turn can accept it.",
        );
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("renders accepted steers as non-cancelable steering rows", async () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <FollowUpQueueShelf
        items={[]}
        steeringItems={[
          {
            id: "steer-1",
            preview: "check whether the design finished",
            promptText: "check whether the design finished",
            dispatchedAt: "2026-05-25T16:05:10.616Z",
          },
        ]}
        actionLabel="Send"
        actionTitle="Club Code will send this follow-up as soon as the active turn can accept it."
        actionEnabled={true}
        onToggleExpanded={vi.fn()}
        onAction={vi.fn()}
        onRemove={onRemove}
        onClear={onClear}
        onExpandImage={vi.fn()}
      />,
      { container: host },
    );

    try {
      expect(document.body.textContent ?? "").toContain("1 message steering");
      expect(document.body.textContent ?? "").toContain("Steering");
      await expect
        .element(page.getByLabelText("Follow-up steering into active turn"))
        .toBeInTheDocument();
      await expect.element(page.getByLabelText("Remove queued message")).not.toBeInTheDocument();
      await expect.element(page.getByText("Clear")).not.toBeInTheDocument();
      expect(onRemove).not.toHaveBeenCalled();
      expect(onClear).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("renders compact-blocked steer retries as automatic steering waits", async () => {
    const onAction = vi.fn();
    const onRemove = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <FollowUpQueueShelf
        items={[
          {
            id: "queued-steer-compact",
            preview: "keep going after compact",
            promptText: "keep going after compact",
            images: [],
            queuedAt: "2026-05-27T04:12:04.000Z",
            expanded: false,
            canExpand: false,
            blockedReason: null,
            automaticSteerRetry: {
              nonSteerableTurnKind: "compact",
            },
          },
        ]}
        actionLabel="Send"
        actionTitle="Club Code will send this follow-up as soon as the active turn can accept it."
        actionEnabled={true}
        onToggleExpanded={vi.fn()}
        onAction={onAction}
        onRemove={onRemove}
        onClear={vi.fn()}
        onExpandImage={vi.fn()}
      />,
      { container: host },
    );

    try {
      expect(document.body.textContent ?? "").toContain("1 steer waiting for compact");
      expect(document.body.textContent ?? "").toContain("Waiting for compact");
      await expect
        .element(page.getByLabelText("Queued steer waiting for Codex context compaction"))
        .toBeInTheDocument();
      await expect.element(page.getByText("Send")).not.toBeInTheDocument();

      await page.getByLabelText("Remove queued message").click();
      expect(onRemove).toHaveBeenCalledWith("queued-steer-compact");
      expect(onAction).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("exposes expansion and image previews for queued attachments", async () => {
    const onToggleExpanded = vi.fn();
    const onExpandImage = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <FollowUpQueueShelf
        items={[
          {
            id: "queued-image",
            preview: "short",
            promptText: "short",
            images: [
              {
                type: "image",
                id: "img-1",
                name: "cat.png",
                mimeType: "image/png",
                sizeBytes: 64,
                previewUrl:
                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
              },
            ],
            queuedAt: "2026-05-22T00:00:00.000Z",
            expanded: true,
            canExpand: true,
            blockedReason: null,
          },
        ]}
        actionLabel="Send"
        actionTitle="Club Code will send this follow-up as soon as the active turn can accept it."
        actionEnabled={true}
        onToggleExpanded={onToggleExpanded}
        onAction={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        onExpandImage={onExpandImage}
      />,
      { container: host },
    );

    try {
      await expect.element(page.getByLabelText("Collapse queued message")).toBeInTheDocument();
      await page.getByLabelText("Preview queued image cat.png").click();
      expect(onExpandImage).toHaveBeenCalledWith({
        images: [{ src: expect.stringContaining("data:image/png;base64,"), name: "cat.png" }],
        index: 0,
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("keeps a waiting follow-up inert while the active provider cannot safely steer", async () => {
    const onAction = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <FollowUpQueueShelf
        items={[
          {
            id: "queued-waiting",
            preview: "do not interrupt the active turn",
            promptText: "do not interrupt the active turn",
            images: [],
            queuedAt: "2026-07-27T00:00:00.000Z",
            expanded: false,
            canExpand: false,
            blockedReason: null,
          },
        ]}
        actionLabel="Waiting"
        actionTitle="Club Code will send this follow-up as soon as the active turn can accept it."
        actionEnabled={false}
        onToggleExpanded={vi.fn()}
        onAction={onAction}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        onExpandImage={vi.fn()}
      />,
      { container: host },
    );

    try {
      const waitingButton = page.getByRole("button", {
        name: "Waiting. Club Code will send this follow-up as soon as the active turn can accept it.",
      });
      await expect.element(waitingButton).toHaveAttribute("aria-disabled", "true");
      const waitingElement = host.querySelector<HTMLButtonElement>('button[aria-disabled="true"]');
      expect(waitingElement).not.toBeNull();
      waitingElement?.focus();
      expect(document.activeElement).toBe(waitingElement);
      waitingElement?.click();
      expect(onAction).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("keeps an individually blocked follow-up inert even when the shelf action is enabled", async () => {
    const onAction = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <FollowUpQueueShelf
        items={[
          {
            id: "queued-blocked",
            preview: "wait for the failed attachment to be retried",
            promptText: "wait for the failed attachment to be retried",
            images: [],
            queuedAt: "2026-07-27T00:00:00.000Z",
            expanded: false,
            canExpand: false,
            blockedReason: "Attachment upload must be retried.",
          },
        ]}
        actionLabel="Steer"
        actionTitle="Steer this queued follow-up into the active turn without interrupting it."
        actionEnabled={true}
        onToggleExpanded={vi.fn()}
        onAction={onAction}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        onExpandImage={vi.fn()}
      />,
      { container: host },
    );

    try {
      const blockedButton = page.getByRole("button", {
        name: "Steer. Attachment upload must be retried.",
      });
      await expect.element(blockedButton).toHaveAttribute("aria-disabled", "true");
      await expect
        .element(blockedButton)
        .toHaveAttribute("title", "Attachment upload must be retried.");
      const blockedElement = host.querySelector<HTMLButtonElement>('button[aria-disabled="true"]');
      expect(blockedElement).not.toBeNull();
      blockedElement?.click();
      expect(onAction).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
