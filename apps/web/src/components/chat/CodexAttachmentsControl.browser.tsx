import "../../index.css";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@cafecode/contracts";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CodexAttachmentsControl } from "./CodexAttachmentsControl";

vi.mock("../../uiLocalization", () => ({
  useUiLocalization: () => ({ t: (english: string) => english }),
}));

const harness = vi.hoisted(() => ({
  request: vi.fn(),
  connection: {} as unknown,
  listener: (() => {}) as () => void,
}));
vi.mock("../../environments/runtime", () => ({
  readEnvironmentConnection: () => harness.connection,
  requireEnvironmentConnection: () => harness.connection,
  subscribeEnvironmentConnections: (listener: () => void) => {
    harness.listener = listener;
    return () => {};
  },
}));
const props = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("t-1"),
  providerInstanceId: ProviderInstanceId.make("codex-1"),
};
const record = {
  id: "a",
  attachmentType: "note",
  identityKey: "key",
  payloadJson: '{"text":"saved"}',
  createdAt: 0,
};
function reset() {
  harness.request.mockReset();
  harness.connection = { client: { server: { codexThreadAttachments: harness.request } } };
}

it("clears records and ignores a pending read when the thread changes", async () => {
  reset();
  harness.request.mockResolvedValueOnce({ data: [record], nextCursor: null });
  const screen = await render(<CodexAttachmentsControl {...props} />);
  await page.getByText("Codex attachments", { exact: true }).click();
  await page.getByRole("button", { name: "Read attachments", exact: true }).click();
  await expect.element(page.getByText(record.payloadJson, { exact: true })).toBeVisible();
  let resolve!: (value: unknown) => void;
  harness.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await page.getByRole("button", { name: "Read attachments", exact: true }).click();
  await screen.rerender(
    <CodexAttachmentsControl {...props} threadId={ThreadId.make("replacement")} />,
  );
  resolve({ data: [record], nextCursor: null });
  await expect.element(page.getByText(record.payloadJson, { exact: true })).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: "Read attachments", exact: true }))
    .toBeEnabled();
  await screen.unmount();
});

it("reads only on request and requires two clicks to remove a record", async () => {
  reset();
  harness.request.mockResolvedValue({ data: [record], nextCursor: null });
  const screen = await render(<CodexAttachmentsControl {...props} />);
  await page.getByText("Codex attachments", { exact: true }).click();
  expect(harness.request).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Read attachments", exact: true }).click();
  await expect.element(page.getByText(record.payloadJson, { exact: true })).toBeVisible();
  expect(harness.request).toHaveBeenCalledWith({
    threadId: props.threadId,
    providerInstanceId: props.providerInstanceId,
    action: { kind: "list" },
  });
  await page.getByRole("button", { name: "Remove record", exact: true }).click();
  expect(harness.request).toHaveBeenCalledTimes(1);
  await page.getByRole("button", { name: "Confirm removal", exact: true }).click();
  expect(harness.request).toHaveBeenLastCalledWith({
    threadId: props.threadId,
    providerInstanceId: props.providerInstanceId,
    action: { kind: "remove", attachmentType: "note", identityKey: "key" },
  });
  await screen.unmount();
});

it("drops late results when the connection is replaced and masks provider errors", async () => {
  reset();
  let resolve!: (result: unknown) => void;
  harness.request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const screen = await render(<CodexAttachmentsControl {...props} />);
  await page.getByText("Codex attachments", { exact: true }).click();
  await page.getByRole("button", { name: "Read attachments", exact: true }).click();
  harness.connection = { client: { server: { codexThreadAttachments: harness.request } } };
  harness.listener();
  resolve({ data: [record], nextCursor: null });
  await expect.element(page.getByText(record.payloadJson, { exact: true })).not.toBeInTheDocument();
  harness.request.mockRejectedValue(new Error("private-provider-secret"));
  await page.getByRole("button", { name: "Read attachments", exact: true }).click();
  await expect.element(page.getByRole("alert")).toBeVisible();
  await expect
    .element(page.getByText("private-provider-secret", { exact: true }))
    .not.toBeInTheDocument();
  await screen.unmount();
});
