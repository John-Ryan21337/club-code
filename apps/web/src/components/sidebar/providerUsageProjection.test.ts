import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import { projectProviderUsageRows } from "./providerUsageProjection";

const CHECKED_AT = "2026-07-26T12:34:56.000Z";

function makeProvider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex-personal"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Personal Codex",
    enabled: true,
    installed: true,
    version: "1.2.3",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: CHECKED_AT,
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

function withRateLimits(
  provider: ServerProvider,
  rateLimits: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): ServerProvider {
  return {
    ...provider,
    accountRateLimits: {
      checkedAt: CHECKED_AT,
      rateLimits,
      ...overrides,
    } as NonNullable<ServerProvider["accountRateLimits"]>,
  };
}

function expectNotSerialized(value: unknown, rawValues: ReadonlyArray<string>): void {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues) {
    expect(serialized).not.toContain(rawValue);
  }
}

describe("projectProviderUsageRows", () => {
  it("keeps every configured provider in order with sanitized fixed status copy", () => {
    const secret = "raw-secret-that-must-not-render";
    const cases = [
      [
        "Future Driver",
        {
          availability: "unavailable",
          unavailableReason: `missing binary at C:\\private\\${secret}`,
          driver: ProviderDriverKind.make("future_driver"),
        },
        "driver-unavailable",
      ],
      ["Disabled", { enabled: false, status: "disabled" }, "disabled"],
      ["Missing", { installed: false }, "not-installed"],
      [
        "Signed Out",
        { auth: { status: "unauthenticated", email: `person@${secret}.example`, label: secret } },
        "unauthenticated",
      ],
      ["Broken", { status: "error" }, "provider-error"],
      ["Unknown", { auth: { status: "unknown", type: secret } }, "authentication-unknown"],
      ["Community Driver", { driver: ProviderDriverKind.make("community_driver") }, "not-reported"],
    ] as const;
    const providers = cases.map(([displayName, overrides], index) =>
      makeProvider({
        instanceId: ProviderInstanceId.make(`private-${index}`),
        displayName,
        message: secret,
        ...overrides,
      }),
    );

    const rows = projectProviderUsageRows(providers);

    expect(rows.map((row) => [row.name, row.state])).toEqual(
      cases.map(([name, , state]) => [name, state]),
    );
    expectNotSerialized(rows, [secret, ...providers.map(({ instanceId }) => instanceId)]);
  });

  it("uses bounded display names, rejects paths and credentials, and disambiguates duplicates", () => {
    const named = (instanceId: string, displayName: string) =>
      makeProvider({
        instanceId: ProviderInstanceId.make(instanceId),
        displayName,
      });
    const providers = [
      named("codex-one-private", "Work Codex"),
      named("codex-two-private", "  Work   Codex  "),
      named("codex-path-private", "C:\\Users\\private\\Codex"),
      named("codex-token-private", "token=sk-privatecredential"),
      named("codex-raw-private", "Account codex-raw-private"),
      named("codex_under_private", "Account codex under private"),
    ];

    const names = projectProviderUsageRows(providers).map((row) => row.name);

    expect(names).toEqual([
      "Work Codex 1",
      "Work Codex 2",
      "Codex 1",
      "Codex 2",
      "Codex 3",
      "Codex 4",
    ]);
    expectNotSerialized(names, [
      "C:\\Users",
      "sk-privatecredential",
      "codex-raw-private",
      "codex under private",
    ]);
  });

  it("attributes orchestrated Claude usage only to its owning configured instance", () => {
    const claude = (instanceId: string, displayName: string, usedPercent: number) =>
      withRateLimits(
        makeProvider({
          instanceId: ProviderInstanceId.make(instanceId),
          driver: ProviderDriverKind.make("claudeAgent"),
          displayName,
        }),
        { primary: { usedPercent } },
      );
    const rows = projectProviderUsageRows([
      claude("claude-personal-private", "Claude Personal", 20),
      claude("claude-work-private", "Claude Work", 75),
    ]);

    expect(rows.map((row) => row.windows.map((window) => window.usedPercent))).toEqual([
      [20],
      [75],
    ]);
    expect(rows.flatMap((row) => row.windows)).toHaveLength(2);
    expectNotSerialized(rows, ["claude-personal-private", "claude-work-private"]);
  });

  it("maps exact refresh failures without exposing routing identities or raw failures", () => {
    const failedWithoutSnapshot = makeProvider({
      instanceId: ProviderInstanceId.make("failed-private-instance"),
      displayName: "Failed Provider",
    });
    const stale = withRateLimits(
      makeProvider({
        instanceId: ProviderInstanceId.make("stale-private-instance"),
        displayName: "Stale Provider",
      }),
      { primary: { usedPercent: 40 } },
    );
    const failures = new Set([failedWithoutSnapshot.instanceId, stale.instanceId]) as ReadonlySet<
      ServerProvider["instanceId"]
    >;

    const rows = projectProviderUsageRows([failedWithoutSnapshot, stale], {
      refreshFailedInstanceIds: failures,
    });

    expect(rows[0]?.state).toBe("refresh-failed");
    expect(rows[0]?.issues.map((issue) => issue.code)).toEqual(["refresh-failed"]);
    expect(rows[1]?.state).toBe("reported");
    expect(rows[1]?.windows[0]?.usedPercent).toBe(40);
    expect(rows[1]?.issues.map((issue) => issue.code)).toContain("refresh-failed");
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("failed-private-instance");
    expect(serialized).not.toContain("stale-private-instance");
  });

  it("projects base and additional windows deterministically without raw provider labels", () => {
    const provider = withRateLimits(
      makeProvider(),
      {
        limitId: "private-base-id",
        limitName: "Private Base Name",
        planType: "private-plan",
        primary: {
          usedPercent: 12.5,
          windowDurationMins: 300,
          resetsAt: 1_800_000_000,
        },
        secondary: { resetsAt: 1_900_000_000 },
      },
      {
        rateLimitsByLimitId: {
          "z-private-limit": {
            limitName: "Private Z Name",
            primary: { usedPercent: 60 },
          },
          "a-private-limit": {
            limitName: "Private A Name",
            secondary: { usedPercent: 30 },
          },
          "private-base-id": {
            limitId: "private-base-id",
            primary: { usedPercent: 99 },
          },
        },
      },
    );

    const [row] = projectProviderUsageRows([provider]);

    expect(row?.state).toBe("reported");
    expect(row?.checkedAt).toBe(CHECKED_AT);
    expect(
      row?.windows.map(({ label, usedPercent, resetsAt }) => [label, usedPercent, resetsAt]),
    ).toEqual([
      ["Account primary window", 12.5, 1_800_000_000],
      ["Account secondary window", null, 1_900_000_000],
      ["Additional limit 1 secondary window", 30, null],
      ["Additional limit 2 primary window", 60, null],
    ]);
    expect(row?.windows[0]?.windowDurationMins).toBe(300);
    expectNotSerialized(row, [
      "private-base-id",
      "Private Base Name",
      "private-plan",
      "z-private-limit",
      "Private Z Name",
      "a-private-limit",
      "Private A Name",
    ]);
  });

  it("treats every finite percentage at or above 100 as exhausted without fabricating a meter", () => {
    const provider = withRateLimits(makeProvider(), {
      primary: { usedPercent: 100 },
      secondary: { usedPercent: 125 },
    });

    const [row] = projectProviderUsageRows([provider]);

    expect(row?.windows).toEqual([
      expect.objectContaining({ usedPercent: 100, exhausted: true }),
      expect.objectContaining({ usedPercent: null, exhausted: true }),
    ]);
    expect(row?.exhaustionNotices).toHaveLength(2);
    expect(row?.issues.map((issue) => issue.code)).toContain("invalid-usage-percent");
    expect(JSON.stringify(row)).not.toContain("125");
  });

  it("fails malformed percentages, reset times, durations, and timestamps closed", () => {
    const malformed = withRateLimits(
      makeProvider(),
      {
        primary: {
          usedPercent: Number.NaN,
          resetsAt: 0,
          windowDurationMins: -1,
        },
        secondary: {
          usedPercent: Number.POSITIVE_INFINITY,
          resetsAt: Number.MAX_SAFE_INTEGER,
          windowDurationMins: 5_270_401,
        },
        individualLimit: {
          limit: "private limit",
          used: "private used",
          remainingPercent: -5,
          resetsAt: 0,
        },
      },
      { checkedAt: "2026-02-30T12:34:56Z" },
    );

    const [row] = projectProviderUsageRows([malformed]);

    expect(projectProviderUsageRows([withRateLimits(makeProvider(), {})])[0]?.state).toBe(
      "no-usable-limits",
    );
    expect(row?.state).toBe("no-usable-limits");
    expect(row?.checkedAt).toBeNull();
    expect(row?.windows).toEqual([]);
    expect(row?.details).toEqual([]);
    expect(row?.exhaustionNotices).toEqual([]);
    expect(row?.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "invalid-checked-at",
        "invalid-usage-percent",
        "invalid-reset-time",
        "invalid-window-duration",
        "invalid-individual-limit",
      ]),
    );
    expectNotSerialized(row, ["private limit", "private used", "Infinity", "NaN"]);
    expect(
      projectProviderUsageRows([
        withRateLimits(makeProvider(), {}, { checkedAt: "2026-07-26T12:34:56+01:99" }),
      ])[0]?.checkedAt,
    ).toBeNull();
  });

  it("keeps valid reset-only windows and validates structured safe details", () => {
    const provider = withRateLimits(
      makeProvider(),
      {
        rateLimitReachedType: "private-provider-limit-name",
        spendControlReached: true,
        primary: { resetsAt: 1_800_000_000 },
        credits: {
          hasCredits: true,
          unlimited: false,
          balance: "private balance and account identifier",
        },
        individualLimit: {
          limit: "private limit",
          used: "private used",
          remainingPercent: 0,
          resetsAt: 1_900_000_000,
        },
      },
      {
        rateLimitResetCredits: {
          availableCount: 2,
          credits: [
            {
              id: "private-credit-id",
              resetType: "codexRateLimits",
              status: "available",
              grantedAt: 1_700_000_000,
              expiresAt: 0,
              title: "Private credit title",
              description: "Private credit description",
            },
          ],
        },
      },
    );

    const [row] = projectProviderUsageRows([provider]);

    expect(row?.windows).toEqual([
      expect.objectContaining({ usedPercent: null, resetsAt: 1_800_000_000 }),
    ]);
    expect(row?.details).toEqual([
      expect.objectContaining({ kind: "credits", availability: "available" }),
      expect.objectContaining({
        kind: "individual-spend",
        remainingPercent: 0,
        resetsAt: 1_900_000_000,
        exhausted: true,
      }),
      expect.objectContaining({ kind: "reset-credits", availableCount: 2 }),
    ]);
    expect(row?.exhaustionNotices).toHaveLength(3);
    expectNotSerialized(row, [
      "private-provider-limit-name",
      "private balance and account identifier",
      "private limit",
      "private used",
      "private-credit-id",
      "Private credit title",
      "Private credit description",
    ]);
  });

  it("bounds additional snapshots and remains deterministic without mutating input", () => {
    const limits = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `private-limit-${String(20 - index).padStart(2, "0")}`,
        { primary: { usedPercent: index } },
      ]),
    );
    const provider = withRateLimits(makeProvider(), {}, { rateLimitsByLimitId: limits });
    Object.freeze(provider.accountRateLimits?.rateLimits);
    Object.freeze(provider.accountRateLimits?.rateLimitsByLimitId);
    Object.freeze(provider.accountRateLimits);
    Object.freeze(provider);

    const first = projectProviderUsageRows([provider]);
    const second = projectProviderUsageRows([provider]);

    expect(second).toEqual(first);
    expect(first[0]?.windows).toHaveLength(15);
    expect(first[0]?.issues.map((issue) => issue.code)).toContain("additional-limits-truncated");
    expect(JSON.stringify(first)).not.toContain("private-limit-");
  });
});
