import type {
  ServerProviderAccountRateLimitSnapshot,
  ServerProviderAccountRateLimitWindow,
  ServerProviderModel,
} from "@cafecode/contracts";
import {
  MAX_MODEL_PACING_RESERVE_PERCENT,
  MIN_MODEL_PACING_RESERVE_PERCENT,
} from "@cafecode/contracts";

export const MODEL_PACING_TOLERANCE_PERCENT = 2;

export type ModelPacingStatus =
  | "under-pace"
  | "on-pace"
  | "over-pace"
  | "reset-due"
  | "clock-skew"
  | "unavailable";

export interface ModelPacingResult {
  readonly status: ModelPacingStatus;
  readonly usedPercent: number | null;
  readonly remainingPercent: number | null;
  readonly targetUsedPercent: number | null;
  readonly targetRemainingPercent: number | null;
  readonly timeToResetMs: number | null;
  readonly elapsedFraction: number | null;
  readonly reservePercent: number;
  readonly recommendation: string;
}

export interface ModelPacingLimitIdentity {
  readonly scope: "model" | "shared";
  readonly label: string;
  readonly matchingModelSlug: string | null;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const normalizeIdentity = (value: string | null | undefined): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

/**
 * A rate-limit identifier is called model-specific only when exactly one
 * available model has an exact slug/name/short-name match. Everything else is
 * intentionally labelled as a shared/provider limit; guessing would turn an
 * account-wide recommendation into unsafe routing advice.
 */
export function identifyModelPacingLimit(input: {
  readonly snapshotKey: string;
  readonly snapshot: ServerProviderAccountRateLimitSnapshot;
  readonly models: ReadonlyArray<ServerProviderModel>;
}): ModelPacingLimitIdentity {
  const reportedNames = new Set(
    [
      input.snapshot.limitId,
      input.snapshot.limitName,
      input.snapshotKey === "default" ? null : input.snapshotKey,
    ]
      .map(normalizeIdentity)
      .filter((value): value is string => value !== null),
  );
  const matches = input.models.filter((model) =>
    [model.slug, model.name, model.shortName]
      .map(normalizeIdentity)
      .some((candidate) => candidate !== null && reportedNames.has(candidate)),
  );

  const matchingModel = matches.length === 1 ? matches.at(0) : undefined;
  if (matchingModel) {
    return {
      scope: "model",
      label: matchingModel.name,
      matchingModelSlug: matchingModel.slug,
    };
  }

  const reportedLabel =
    input.snapshot.limitName?.trim() ||
    input.snapshot.limitId?.trim() ||
    input.snapshotKey.trim() ||
    "Provider";
  return {
    scope: "shared",
    label: `${reportedLabel} (shared/account limit)`,
    matchingModelSlug: null,
  };
}

export function calculateModelPacing(input: {
  readonly window: ServerProviderAccountRateLimitWindow | null | undefined;
  readonly nowMs: number;
  readonly reservePercent: number;
}): ModelPacingResult {
  const reservePercent = clamp(
    Number.isFinite(input.reservePercent) ? input.reservePercent : 0,
    MIN_MODEL_PACING_RESERVE_PERCENT,
    MAX_MODEL_PACING_RESERVE_PERCENT,
  );
  const rawUsedPercent = input.window?.usedPercent;
  const usedPercent =
    typeof rawUsedPercent === "number" && Number.isFinite(rawUsedPercent)
      ? clamp(rawUsedPercent, 0, 100)
      : null;
  const remainingPercent = usedPercent === null ? null : 100 - usedPercent;
  const durationMinutes = input.window?.windowDurationMins;
  const resetsAt = input.window?.resetsAt;

  if (
    usedPercent === null ||
    typeof durationMinutes !== "number" ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0 ||
    typeof resetsAt !== "number" ||
    !Number.isFinite(resetsAt) ||
    resetsAt <= 0 ||
    !Number.isFinite(input.nowMs)
  ) {
    return {
      status: "unavailable",
      usedPercent,
      remainingPercent,
      targetUsedPercent: null,
      targetRemainingPercent: null,
      timeToResetMs: null,
      elapsedFraction: null,
      reservePercent,
      recommendation: "Pacing unavailable until the provider reports usage, window, and reset.",
    };
  }

  const nowSeconds = input.nowMs / 1_000;
  const durationSeconds = durationMinutes * 60;
  const startsAt = resetsAt - durationSeconds;
  const timeToResetMs = (resetsAt - nowSeconds) * 1_000;
  if (
    !Number.isFinite(nowSeconds) ||
    !Number.isFinite(durationSeconds) ||
    !Number.isFinite(startsAt) ||
    !Number.isFinite(timeToResetMs)
  ) {
    return {
      status: "unavailable",
      usedPercent,
      remainingPercent,
      targetUsedPercent: null,
      targetRemainingPercent: null,
      timeToResetMs: null,
      elapsedFraction: null,
      reservePercent,
      recommendation: "Pacing unavailable until the provider reports a valid usage window.",
    };
  }

  if (nowSeconds < startsAt) {
    return {
      status: "clock-skew",
      usedPercent,
      remainingPercent,
      targetUsedPercent: null,
      targetRemainingPercent: null,
      timeToResetMs: Math.max(0, timeToResetMs),
      elapsedFraction: null,
      reservePercent,
      recommendation: "Refresh usage; the reported window starts after this device clock.",
    };
  }
  // At the exact reset boundary the reported percentage is already stale:
  // don't present a final-window recommendation as if it were current.
  if (nowSeconds >= resetsAt) {
    return {
      status: "reset-due",
      usedPercent,
      remainingPercent,
      targetUsedPercent: null,
      targetRemainingPercent: null,
      timeToResetMs: 0,
      elapsedFraction: 1,
      reservePercent,
      recommendation: "Refresh usage; this reported reset time has passed.",
    };
  }

  const elapsedFraction = clamp((nowSeconds - startsAt) / durationSeconds, 0, 1);
  const targetUsedPercent = (100 - reservePercent) * elapsedFraction;
  const targetRemainingPercent = 100 - targetUsedPercent;
  const paceDelta = usedPercent - targetUsedPercent;
  const status: ModelPacingStatus =
    paceDelta < -MODEL_PACING_TOLERANCE_PERCENT
      ? "under-pace"
      : paceDelta > MODEL_PACING_TOLERANCE_PERCENT
        ? "over-pace"
        : "on-pace";
  const recommendation =
    status === "under-pace"
      ? "Under pace: room to use this limit."
      : status === "over-pace"
        ? "Over pace: conserve this limit until the next reset."
        : "On pace for this reset window.";

  return {
    status,
    usedPercent,
    remainingPercent,
    targetUsedPercent,
    targetRemainingPercent,
    timeToResetMs: Math.max(0, timeToResetMs),
    elapsedFraction,
    reservePercent,
    recommendation,
  };
}

export function formatModelPacingDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs)) {
    return "reset unknown";
  }
  if (durationMs <= 0) {
    return "reset due";
  }
  const totalMinutes = Math.max(1, Math.ceil(durationMs / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h to reset`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m to reset`;
  }
  return `${minutes}m to reset`;
}
