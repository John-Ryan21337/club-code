import { describe, expect, it } from "vitest";

import {
  formatPendingPrimaryActionLabel,
  isComposerPrimaryActionDisabled,
} from "./ComposerPrimaryActions";

describe("isComposerPrimaryActionDisabled", () => {
  it("keeps the queue action enabled during a provider handoff", () => {
    expect(
      isComposerPrimaryActionDisabled({
        isSendBusy: true,
        isConnecting: true,
        isEnvironmentUnavailable: false,
        hasSendableContent: true,
        canQueueDuringHandoff: true,
      }),
    ).toBe(false);
  });

  it("keeps unsafe or incomplete actions disabled", () => {
    expect(
      isComposerPrimaryActionDisabled({
        isSendBusy: true,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        hasSendableContent: true,
        canQueueDuringHandoff: false,
      }),
    ).toBe(true);
    expect(
      isComposerPrimaryActionDisabled({
        isSendBusy: false,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        hasSendableContent: false,
        canQueueDuringHandoff: true,
      }),
    ).toBe(true);
  });
});

describe("formatPendingPrimaryActionLabel", () => {
  it("returns 'Submitting...' while responding", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: true,
        questionIndex: 0,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submitting...' while responding regardless of other flags", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: true,
        questionIndex: 3,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submit' in compact mode on the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit");
  });

  it("returns 'Next' in compact mode when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Next");
  });

  it("returns 'Next question' when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Next question");
  });

  it("returns singular 'Submit answer' on the last question when it is the only question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit answer");
  });

  it("returns plural 'Submit answers' on the last question when there are multiple questions", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Submit answers");
  });

  it("returns plural 'Submit answers' for higher question indices", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 5,
      }),
    ).toBe("Submit answers");
  });
});
