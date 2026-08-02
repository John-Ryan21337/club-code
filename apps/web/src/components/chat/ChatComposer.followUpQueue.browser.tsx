import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { FollowUpQueueShelf } from "./ChatComposer";

afterEach(async () => {
  await cleanup();
});

describe("FollowUpQueueShelf FIFO actions", () => {
  it("keeps later operator follow-ups waiting behind the queue head", async () => {
    const onAction = vi.fn();

    await render(
      <FollowUpQueueShelf
        items={[
          {
            id: "first",
            preview: "First operator command",
            promptText: "First operator command",
            images: [],
            queuedAt: "2026-07-28T12:00:00.000Z",
            expanded: false,
            canExpand: false,
            blockedReason: null,
          },
          {
            id: "second",
            preview: "Second operator command",
            promptText: "Second operator command",
            images: [],
            queuedAt: "2026-07-28T12:00:01.000Z",
            expanded: false,
            canExpand: false,
            blockedReason: null,
          },
        ]}
        actionLabel="Steer"
        actionTitle="Steer this queued follow-up."
        actionEnabled
        onToggleExpanded={vi.fn()}
        onAction={onAction}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        onExpandImage={vi.fn()}
      />,
    );

    const waitingAction = page.getByRole("button", {
      name: "Steer. This follow-up will wait for earlier queued messages to dispatch first.",
    });
    await expect.element(waitingAction).toHaveAttribute("aria-disabled", "true");
    expect(onAction).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Steer", exact: true }).click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith("first");
  });
});
