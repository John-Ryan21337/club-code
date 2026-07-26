import type { ServerProvider } from "@cafecode/contracts";

import { formatProviderDriverKindLabel } from "../../providerModels";

const MAX_ADDITIONAL_SNAPSHOTS = 15;
const MAX_DISPLAY_NAME_LENGTH = 64;
const MAX_EPOCH_SECONDS = 253_402_300_799;
const MAX_RESET_CREDIT_COUNT = 1_000_000;
const MAX_WINDOW_DURATION_MINUTES = 5_270_400;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const SAFE_DRIVER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const SAFE_DISPLAY_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,'()&+_-]*$/u;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const SENSITIVE_DISPLAY_NAME_PATTERN =
  /(?:[/\\]|:\/\/|[\w.+-]+@[\w.-]+|(?:^|\s)(?:bearer|token|password|secret|credential|api[ _-]?key)(?:\s|[:=]|$)|(?:sk-|ghp_|github_pat_|xox[baprs]-|AKIA)[a-zA-Z0-9_-]{8,})/i;

export type ProviderUsageState =
  | "reported"
  | "driver-unavailable"
  | "disabled"
  | "not-installed"
  | "provider-error"
  | "unauthenticated"
  | "authentication-unknown"
  | "refresh-failed"
  | "not-reported"
  | "no-usable-limits";

export type ProviderUsageIssueCode =
  | "refresh-failed"
  | "invalid-checked-at"
  | "invalid-window"
  | "invalid-usage-percent"
  | "invalid-window-duration"
  | "invalid-reset-time"
  | "invalid-exhaustion-signal"
  | "invalid-credit-summary"
  | "invalid-individual-limit"
  | "invalid-reset-credit-count"
  | "additional-limits-truncated";

export interface ProviderUsageWindow {
  readonly label: string;
  readonly usedPercent: number | null;
  readonly windowDurationMins: number | null;
  readonly resetsAt: number | null;
  readonly exhausted: boolean;
}

export interface ProviderUsageExhaustionNotice {
  readonly label: string;
  readonly message: string;
}

export type ProviderUsageDetail =
  | {
      readonly kind: "credits";
      readonly label: string;
      readonly availability: "unlimited" | "available" | "unavailable";
    }
  | {
      readonly kind: "individual-spend";
      readonly label: string;
      readonly remainingPercent: number | null;
      readonly resetsAt: number | null;
      readonly exhausted: boolean;
    }
  | {
      readonly kind: "reset-credits";
      readonly label: string;
      readonly availableCount: number;
    };

export interface ProviderUsageIssue {
  readonly code: ProviderUsageIssueCode;
  readonly message: string;
}

export interface ProviderUsageRow {
  readonly driverLabel: string;
  readonly name: string;
  readonly state: ProviderUsageState;
  readonly stateLabel: string;
  readonly stateDetail: string | null;
  readonly checkedAt: string | null;
  readonly windows: ReadonlyArray<ProviderUsageWindow>;
  readonly exhaustionNotices: ReadonlyArray<ProviderUsageExhaustionNotice>;
  readonly details: ReadonlyArray<ProviderUsageDetail>;
  readonly issues: ReadonlyArray<ProviderUsageIssue>;
}

export interface ProviderUsageProjectionOptions {
  /**
   * Exact routing identities are accepted only as projection context. They are
   * never copied into a row or a user-visible label.
   */
  readonly refreshFailedInstanceIds?: ReadonlySet<ServerProvider["instanceId"]>;
}

interface ProjectionAccumulator {
  readonly windows: Array<ProviderUsageWindow>;
  readonly exhaustionNotices: Array<ProviderUsageExhaustionNotice>;
  readonly details: Array<ProviderUsageDetail>;
  readonly issues: Array<ProviderUsageIssue>;
}

const STATE_COPY: Record<
  ProviderUsageState,
  { readonly label: string; readonly detail: string | null }
> = {
  reported: { label: "Usage reported", detail: null },
  "driver-unavailable": {
    label: "Driver unavailable",
    detail: "This provider driver is unavailable in the current build.",
  },
  disabled: {
    label: "Provider disabled",
    detail: "Usage reporting is unavailable while this provider is disabled.",
  },
  "not-installed": {
    label: "Provider not installed",
    detail: "Usage reporting requires this provider to be installed.",
  },
  "provider-error": {
    label: "Provider unavailable",
    detail: "The provider is not currently ready to report usage.",
  },
  unauthenticated: {
    label: "Sign-in required",
    detail: "Sign in to this provider to view account usage.",
  },
  "authentication-unknown": {
    label: "Authentication unknown",
    detail: "Account usage is unavailable until authentication can be verified.",
  },
  "refresh-failed": {
    label: "Refresh failed",
    detail: "The latest usage refresh failed. Try again later.",
  },
  "not-reported": {
    label: "Usage not reported",
    detail: "This provider has not reported account usage.",
  },
  "no-usable-limits": {
    label: "Usage unavailable",
    detail: "The provider response did not contain usable usage fields.",
  },
};

const ISSUE_MESSAGES: Record<ProviderUsageIssueCode, string> = {
  "refresh-failed": "The latest usage refresh failed; previously reported data may be stale.",
  "invalid-checked-at": "The provider usage timestamp was omitted because it was invalid.",
  "invalid-window": "A malformed provider usage window was omitted.",
  "invalid-usage-percent":
    "A malformed or above-limit usage percentage was omitted; above-limit usage remains exhausted.",
  "invalid-window-duration": "A provider window duration was omitted because it was invalid.",
  "invalid-reset-time": "A provider reset time was omitted because it was invalid.",
  "invalid-exhaustion-signal": "A malformed provider exhaustion signal was omitted.",
  "invalid-credit-summary": "A malformed provider credit summary was omitted.",
  "invalid-individual-limit": "A malformed provider spend limit was omitted.",
  "invalid-reset-credit-count": "A malformed reset-credit count was omitted.",
  "additional-limits-truncated":
    "Some additional provider limits were omitted to keep the usage summary bounded.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetMinute <= 59 &&
    (offsetHour < 14 || (offsetHour === 14 && offsetMinute === 0))
  );
}

function safeDriverLabel(provider: ServerProvider): string {
  const driver = String(provider.driver);
  return SAFE_DRIVER_PATTERN.test(driver) && !SENSITIVE_DISPLAY_NAME_PATTERN.test(driver)
    ? formatProviderDriverKindLabel(provider.driver)
    : "Provider";
}

function safeDisplayName(provider: ServerProvider, fallback: string): string {
  if (typeof provider.displayName !== "string") {
    return fallback;
  }
  if (CONTROL_CHARACTER_PATTERN.test(provider.displayName)) {
    return fallback;
  }
  const candidate = provider.displayName.replace(/\s+/g, " ").trim();
  if (
    candidate.length === 0 ||
    candidate.length > MAX_DISPLAY_NAME_LENGTH ||
    !SAFE_DISPLAY_NAME_PATTERN.test(candidate) ||
    SENSITIVE_DISPLAY_NAME_PATTERN.test(candidate)
  ) {
    return fallback;
  }
  const instanceId = String(provider.instanceId).toLowerCase().replace(/[_-]+/g, "-");
  const driver = String(provider.driver).toLowerCase().replace(/[_-]+/g, "-");
  const slugLikeCandidate = candidate.toLowerCase().replace(/[ _-]+/g, "-");
  if (instanceId !== driver && slugLikeCandidate.includes(instanceId)) {
    return fallback;
  }
  return candidate;
}

function providerNames(providers: ReadonlyArray<ServerProvider>): ReadonlyArray<string> {
  const candidates = providers.map((provider) =>
    safeDisplayName(provider, safeDriverLabel(provider)),
  );
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();
  return candidates.map((candidate) => {
    const key = candidate.toLowerCase();
    if ((counts.get(key) ?? 0) <= 1) {
      return candidate;
    }
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    return `${candidate} ${occurrence}`;
  });
}

function addIssue(accumulator: ProjectionAccumulator, code: ProviderUsageIssueCode): void {
  accumulator.issues.push({
    code,
    message: ISSUE_MESSAGES[code],
  });
}

function validBoundedPositiveInteger(
  value: unknown,
  accumulator: ProjectionAccumulator,
  maximum: number,
  issueCode: "invalid-reset-time" | "invalid-window-duration",
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum) {
    return value;
  }
  addIssue(accumulator, issueCode);
  return null;
}

function validResetTime(value: unknown, accumulator: ProjectionAccumulator): number | null {
  return validBoundedPositiveInteger(value, accumulator, MAX_EPOCH_SECONDS, "invalid-reset-time");
}

function projectWindow(
  snapshotLabel: string,
  kind: "primary" | "secondary",
  value: unknown,
  accumulator: ProjectionAccumulator,
): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!isRecord(value)) {
    addIssue(accumulator, "invalid-window");
    return;
  }

  const rawPercent = value.usedPercent;
  let usedPercent: number | null = null;
  let exhausted = false;
  if (rawPercent !== undefined && rawPercent !== null) {
    if (typeof rawPercent === "number" && Number.isFinite(rawPercent) && rawPercent >= 0) {
      exhausted = rawPercent >= 100;
      if (rawPercent <= 100) {
        usedPercent = rawPercent;
      } else {
        addIssue(accumulator, "invalid-usage-percent");
      }
    } else {
      addIssue(accumulator, "invalid-usage-percent");
    }
  }

  const resetsAt = validResetTime(value.resetsAt, accumulator);
  const windowDurationMins = validBoundedPositiveInteger(
    value.windowDurationMins,
    accumulator,
    MAX_WINDOW_DURATION_MINUTES,
    "invalid-window-duration",
  );
  if (usedPercent === null && resetsAt === null && !exhausted) {
    return;
  }

  const label = `${snapshotLabel} ${kind} window`;
  accumulator.windows.push({
    label,
    usedPercent,
    windowDurationMins,
    resetsAt,
    exhausted,
  });
  if (exhausted) {
    accumulator.exhaustionNotices.push({
      label,
      message: "This usage window is exhausted.",
    });
  }
}

function projectSnapshot(
  snapshotLabel: string,
  value: unknown,
  accumulator: ProjectionAccumulator,
): void {
  if (!isRecord(value)) {
    addIssue(accumulator, "invalid-window");
    return;
  }

  projectWindow(snapshotLabel, "primary", value.primary, accumulator);
  projectWindow(snapshotLabel, "secondary", value.secondary, accumulator);

  if (
    typeof value.rateLimitReachedType === "string" &&
    value.rateLimitReachedType.trim().length > 0
  ) {
    accumulator.exhaustionNotices.push({
      label: snapshotLabel,
      message: "The provider reports that an account usage limit has been reached.",
    });
  } else if (value.rateLimitReachedType !== undefined && value.rateLimitReachedType !== null) {
    addIssue(accumulator, "invalid-exhaustion-signal");
  }

  if (value.spendControlReached === true) {
    accumulator.exhaustionNotices.push({
      label: snapshotLabel,
      message: "The provider reports that an account spend control has been reached.",
    });
  } else if (
    value.spendControlReached !== undefined &&
    value.spendControlReached !== null &&
    value.spendControlReached !== false
  ) {
    addIssue(accumulator, "invalid-exhaustion-signal");
  }

  if (value.credits !== undefined && value.credits !== null) {
    if (
      isRecord(value.credits) &&
      typeof value.credits.hasCredits === "boolean" &&
      typeof value.credits.unlimited === "boolean"
    ) {
      accumulator.details.push({
        kind: "credits",
        label: `${snapshotLabel} credits`,
        availability: value.credits.unlimited
          ? "unlimited"
          : value.credits.hasCredits
            ? "available"
            : "unavailable",
      });
    } else {
      addIssue(accumulator, "invalid-credit-summary");
    }
  }

  if (value.individualLimit !== undefined && value.individualLimit !== null) {
    if (!isRecord(value.individualLimit)) {
      addIssue(accumulator, "invalid-individual-limit");
    } else {
      const rawRemaining = value.individualLimit.remainingPercent;
      const remainingPercent =
        typeof rawRemaining === "number" &&
        Number.isFinite(rawRemaining) &&
        rawRemaining >= 0 &&
        rawRemaining <= 100
          ? rawRemaining
          : null;
      if (remainingPercent === null) {
        addIssue(accumulator, "invalid-individual-limit");
      }
      const resetsAt = validResetTime(value.individualLimit.resetsAt, accumulator);
      if (remainingPercent !== null || resetsAt !== null) {
        const exhausted = remainingPercent === 0;
        accumulator.details.push({
          kind: "individual-spend",
          label: `${snapshotLabel} spend allowance`,
          remainingPercent,
          resetsAt,
          exhausted,
        });
        if (exhausted) {
          accumulator.exhaustionNotices.push({
            label: snapshotLabel,
            message: "No individual spend allowance remains.",
          });
        }
      }
    }
  }
}

function projectRateLimits(
  value: unknown,
  refreshFailed: boolean,
): {
  readonly state: ProviderUsageState;
  readonly checkedAt: string | null;
  readonly accumulator: ProjectionAccumulator;
} {
  const accumulator: ProjectionAccumulator = {
    windows: [],
    exhaustionNotices: [],
    details: [],
    issues: [],
  };
  if (refreshFailed) {
    addIssue(accumulator, "refresh-failed");
  }
  if (!isRecord(value)) {
    return {
      state: refreshFailed ? "refresh-failed" : "not-reported",
      checkedAt: null,
      accumulator,
    };
  }

  const checkedAt = isValidIsoDateTime(value.checkedAt) ? value.checkedAt : null;
  if (checkedAt === null) {
    addIssue(accumulator, "invalid-checked-at");
  }

  projectSnapshot("Account", value.rateLimits, accumulator);
  if (value.rateLimitsByLimitId !== undefined && value.rateLimitsByLimitId !== null) {
    if (!isRecord(value.rateLimitsByLimitId)) {
      addIssue(accumulator, "invalid-window");
    } else {
      const baseLimitId =
        isRecord(value.rateLimits) && typeof value.rateLimits.limitId === "string"
          ? value.rateLimits.limitId
          : null;
      const entries = Object.entries(value.rateLimitsByLimitId)
        .filter(([key, snapshot]) => key !== baseLimitId && snapshot !== value.rateLimits)
        .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      const visibleEntries = entries.slice(0, MAX_ADDITIONAL_SNAPSHOTS);
      visibleEntries.forEach(([, snapshot], index) => {
        const ordinal = index + 1;
        projectSnapshot(`Additional limit ${ordinal}`, snapshot, accumulator);
      });
      if (entries.length > visibleEntries.length) {
        addIssue(accumulator, "additional-limits-truncated");
      }
    }
  }

  if (value.rateLimitResetCredits !== undefined && value.rateLimitResetCredits !== null) {
    const resetCredits = value.rateLimitResetCredits;
    if (
      isRecord(resetCredits) &&
      typeof resetCredits.availableCount === "number" &&
      Number.isSafeInteger(resetCredits.availableCount) &&
      resetCredits.availableCount >= 0 &&
      resetCredits.availableCount <= MAX_RESET_CREDIT_COUNT
    ) {
      accumulator.details.push({
        kind: "reset-credits",
        label: "Reset credits",
        availableCount: resetCredits.availableCount,
      });
    } else {
      addIssue(accumulator, "invalid-reset-credit-count");
    }
  }

  const hasUsage =
    accumulator.windows.length > 0 ||
    accumulator.exhaustionNotices.length > 0 ||
    accumulator.details.length > 0;
  return {
    state: hasUsage ? "reported" : refreshFailed ? "refresh-failed" : "no-usable-limits",
    checkedAt,
    accumulator,
  };
}

function statusOnlyRow(
  provider: ServerProvider,
  name: string,
  state: ProviderUsageState,
): ProviderUsageRow {
  const copy = STATE_COPY[state];
  return {
    driverLabel: safeDriverLabel(provider),
    name,
    state,
    stateLabel: copy.label,
    stateDetail: copy.detail,
    checkedAt: null,
    windows: [],
    exhaustionNotices: [],
    details: [],
    issues: [],
  };
}

function projectProvider(
  provider: ServerProvider,
  name: string,
  options: ProviderUsageProjectionOptions,
): ProviderUsageRow {
  if (provider.availability === "unavailable") {
    return statusOnlyRow(provider, name, "driver-unavailable");
  }
  if (!provider.enabled || provider.status === "disabled") {
    return statusOnlyRow(provider, name, "disabled");
  }
  if (!provider.installed) {
    return statusOnlyRow(provider, name, "not-installed");
  }
  if (provider.auth.status === "unauthenticated") {
    return statusOnlyRow(provider, name, "unauthenticated");
  }
  if (provider.status === "error") {
    return statusOnlyRow(provider, name, "provider-error");
  }
  if (provider.auth.status !== "authenticated") {
    return statusOnlyRow(provider, name, "authentication-unknown");
  }

  const refreshFailed = options.refreshFailedInstanceIds?.has(provider.instanceId) === true;
  const projected = projectRateLimits(provider.accountRateLimits, refreshFailed);
  const copy = STATE_COPY[projected.state];
  return {
    driverLabel: safeDriverLabel(provider),
    name,
    state: projected.state,
    stateLabel: copy.label,
    stateDetail: copy.detail,
    checkedAt: projected.checkedAt,
    windows: projected.accumulator.windows,
    exhaustionNotices: projected.accumulator.exhaustionNotices,
    details: projected.accumulator.details,
    issues: projected.accumulator.issues,
  };
}

/**
 * Projects provider snapshots into bounded, presentation-safe rows.
 *
 * The result contains exactly one row per input provider in input order. Raw
 * routing identities, provider messages, account metadata, paths, and raw
 * provider-defined usage labels are intentionally absent.
 */
export function projectProviderUsageRows(
  providers: ReadonlyArray<ServerProvider>,
  options: ProviderUsageProjectionOptions = {},
): ReadonlyArray<ProviderUsageRow> {
  const names = providerNames(providers);
  return providers.map((provider, index) =>
    projectProvider(provider, names[index] ?? safeDriverLabel(provider), options),
  );
}
