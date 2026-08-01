# Adopting Club Code changes in Cafe Code

This guide is for Cafe Code maintainers who want to review or adopt Club Code changes without pulling in the entire local-release branch. It records the published GitHub state observed on 2026-08-01. Re-check each pull request's head SHA and mergeability immediately before landing it; stacked branch state can change after this snapshot.

## Published PR inventory

The repository has published 20 pull requests:

- twelve open implementation PRs: [#2](https://github.com/John-Ryan21337/club-code/pull/2), [#3](https://github.com/John-Ryan21337/club-code/pull/3), [#4](https://github.com/John-Ryan21337/club-code/pull/4), [#7](https://github.com/John-Ryan21337/club-code/pull/7), [#8](https://github.com/John-Ryan21337/club-code/pull/8), [#13](https://github.com/John-Ryan21337/club-code/pull/13), [#14](https://github.com/John-Ryan21337/club-code/pull/14), [#15](https://github.com/John-Ryan21337/club-code/pull/15), [#17](https://github.com/John-Ryan21337/club-code/pull/17), [#18](https://github.com/John-Ryan21337/club-code/pull/18), [#19](https://github.com/John-Ryan21337/club-code/pull/19), and [#20](https://github.com/John-Ryan21337/club-code/pull/20);
- this open documentation PR, [#16](https://github.com/John-Ryan21337/club-code/pull/16), which adds this adoption guide directly against `main`;
- four merged documentation PRs: #9 through #12;
- two closed, archived pacing PRs: #5 and #6; and
- one closed, obsolete omnibus PR: #1.

The active implementation foundation is:

`#2 -> #3 -> #4 -> #7`

After #7, choose one of these paths:

- **Recommended, reviewable path:** `#13 cowork foundation -> #14 database coordination -> #17 memberships/invites -> #20 device-key authority -> later transport/UI slices`.
- **Draft omnibus path:** `#8`, which contains the current local-release aggregate and overlaps the narrow cowork work.
- **Telemetry follow-up:** `#8 -> #15`; #15 is not a cowork dependency and is useful only with the Project Resources implementation from #8.
- **Matrix GPU path:** `#7 -> #18`; #18 is independent of cowork and extracts WebGL2 glyph rendering plus Walk parity without Auto Nudge, provider, or server files.
- **Auto Nudge safety path:** `#7 -> #19`; #19 reconstructs dependency-complete server authority, completion-only dispatch, active-output invalidation, and restart fail-closed behavior without Idle Guard or unrelated #8 features.

Do not combine the cowork commits from #8 with #13, #14, #17, or #20.

## Active ladder snapshot

| PR  | Purpose                                                                                 | Exact base branch                                                          | Observed head                                                                          | Snapshot state                                                   |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| #2  | Club foundation restacked on Cafe 0.146                                                 | `baseline/cafe-dev-20260729` at `77af7bcf29c512caba07a00d04c53ae9cd2c536e` | `agent/4c-default-layout` at `fde09e8e178c32f1259b138b7e5cb1074953705f`                | open, ready, clean                                               |
| #3  | Preserve explicit Claude Opus 4.8 alias regression coverage                             | `agent/4c-default-layout`                                                  | `agent/claude-opus-5-support` at `8fb978ac7b81b95efac013765bec004d99d4243d`            | open, ready, clean                                               |
| #4  | Matrix provider-activity link foundation                                                | `agent/claude-opus-5-support`                                              | `agent/matrix-activity-connecting-lines` at `92e56252202fbcea621b17eedacb05e4f22f3796` | open, ready, clean                                               |
| #7  | Provider usage, completion-event-only Auto Nudge, steering safety, and Matrix hardening | `agent/matrix-activity-connecting-lines`                                   | `agent/local-priority-integration` at `a24a58f2fcbb8bc64fc95cd95ce2518a28c6f699`       | open, ready, clean after an ancestry-only restack                |
| #13 | Secure cowork authorization, signed event admission, and durable event journal          | `agent/local-priority-integration`                                         | `feature/cowork-foundation` at `8ad2ec37e4db8464f351d67e5ad1fb99e6c29939`              | open, ready, clean after merging the current #7 base             |
| #14 | Conflict-safe shared database coordination                                              | `feature/cowork-foundation`                                                | `feature/cowork-database-coordination` at `a3c1650a86e6b5b8c4c7f5eda716fd6d4f56e74d`   | open, ready, clean                                               |
| #17 | Secure memberships and one-time project invitations                                     | `feature/cowork-database-coordination`                                     | `feature/cowork-membership-invites` at `1973b2c1e9d4cc4b85a85077524ecd9a681639b6`      | open, ready, clean                                               |
| #20 | Audited device-key enrollment, rotation, revocation, and current-key admission          | `feature/cowork-membership-invites`                                        | `feature/cowork-device-authority` at `76957bce4c9d89d2126012b45beb37ebdc31f172`        | open, audited, clean                                             |
| #18 | WebGL2 Matrix glyph rendering and Walk parity                                           | `agent/local-priority-integration`                                         | `agent/matrix-webgl-gpu-pr` at `fa2be7e92c744440f6bf47f20174d85a4041a21d`              | open, audited, clean; separate from the cowork ladder            |
| #19 | Completion-only Auto Nudge server authority                                             | `agent/local-priority-integration`                                         | `feature/auto-nudge-server-authority` at `99cb7fe621bbe62443d5b07e4a264a42ba0a47a7`    | open, audited, clean; overlaps #8 Auto Nudge                     |
| #8  | Aggregate current local release                                                         | `agent/local-priority-integration`                                         | `release/local-20260728` at `457be1418541bfb0ab08ae5bf9aac8a729ead23f`                 | open draft; GitHub reported `CONFLICTING/DIRTY` at this snapshot |
| #15 | Hide stale unavailable Project Resources sensor graphs                                  | `release/local-20260728`                                                   | `work/profiles-telemetry-safety` at `9270cc56ffd05132f3ca02bce1582860850c8f0a`         | open, ready, clean; separate from the cowork ladder              |

PR #7 was restacked on the current #4 head with a normal non-force merge whose tree is identical to its prior head; GitHub reported it `MERGEABLE/CLEAN` after focused and full gates passed. Re-check rather than treating that observation as immutable if any base moves again. The same rule applies to #8 if the omnibus path is deliberately chosen. PRs #13, #14, #17, and #20 were also `MERGEABLE/CLEAN` after the #7 restack.

## Recommended merge order

1. Land #2 on the pinned Cafe baseline, or semantically rebase its delta onto the Cafe target selected by the maintainers.
2. Land #3 on #2.
3. Land #4 on #3.
4. Land the repaired #7 on the current #4 head.
5. Land #13 on the repaired #7 head.
6. Land #14, the narrow database-coordination PR, on #13.
7. Land #17, the secure memberships/invitations PR, on #14. It owns migration 072 after #14's database migration 071.
8. Land #20, the audited device-key authority PR, on #17. It owns migration 073 and binds event admission to the member's current non-revoked Ed25519 key.
9. Add transport, replica materialization, operator chat, task/agent coordination, and UI only through later bounded PRs.

## Curated cherry-pick order

Merging the PRs through GitHub is preferred because their base branches document review boundaries. If a maintainer must cherry-pick onto the exact pinned baseline, use a clean integration branch and the order below:

```sh
# PR #2: all commits after the pinned Cafe baseline, oldest first.
git rev-list --reverse 77af7bcf29c512caba07a00d04c53ae9cd2c536e..fde09e8e178c32f1259b138b7e5cb1074953705f | git cherry-pick --stdin

# PR #3: its semantic delta only. The branch-tip cleanup commit duplicates #2.
git cherry-pick 325ca70cf78c9556f4c1668e87534670c5a16c4e

# PR #4: its semantic delta only. The branch-tip cleanup commit duplicates #2.
git cherry-pick 7b09d366d6e31928dbbb8aca8f6fff61e8171879

# PR #7: the unique integration range, including its later safety repairs.
git rev-list --reverse 7b09d366d6e31928dbbb8aca8f6fff61e8171879..cdb4e15680a1b265d27359ce64e1580f8c0a97ed | git cherry-pick --stdin

# PR #13: the contiguous pre-restack cowork foundation series.
git rev-list --reverse 8dc05d58f6457a0a31e14215d3617a9af9aa7760^..375849ce173ce81c90aad62e1bf958f3ef470917 | git cherry-pick --stdin

# PR #14: the contiguous database-coordination series.
git rev-list --reverse a48d9c93aac6e34579e1571289bc37389a216edd^..a3c1650a86e6b5b8c4c7f5eda716fd6d4f56e74d | git cherry-pick --stdin

# PR #17: membership/invitations plus its independent audit repair.
git cherry-pick dfc14718 1973b2c1

# PR #20: device authority plus its independent cryptographic audit repair.
git cherry-pick 6227e02c 76957bce
```

Do not cherry-pick `8fb978ac` or `92e56252` after PR #2: both are branch-local copies of the same completion-event-only Auto Nudge cleanup already present as `fde09e8e`. PR #7's published `a24a58f2` restack commit changes ancestry only, so the curated semantic range intentionally ends at `cdb4e156`. Do not cherry-pick PR #13's final merge commit `8ad2ec37`; apply the contiguous cowork series shown above after #7 instead.

PR #15 is a separate one-commit telemetry follow-up. Cherry-pick `9270cc56ffd05132f3ca02bce1582860850c8f0a` only into a tree that already contains #8's Project Resources implementation; it is not part of the cowork sequence.

PR #18 is a Matrix-only side branch on #7. Prefer merging the reviewed PR; if cherry-picking, preserve its commit order and rerun its contracts, Matrix unit, Chromium, type, and full repository gates.

PR #19 is the reviewable Auto Nudge path after #7. Do not combine it with #8's overlapping Auto Nudge implementation. Its larger coherent surface is required because PR #7 did not yet contain server-authoritative dispatch contracts, projections, migrations, manual-FIFO priority, or restart hydration.

PR #20 continues the cowork ladder after #17. Its audit rejects low-order and identity Ed25519 public keys rather than relying on the runtime verifier alone; preserve that validation when adapting the cryptography layer.

When adopting onto a newer Cafe target instead of the pinned baseline, treat these commands as an ordering manifest, not a promise of conflict-free application. Resolve migrations, settings schemas, provider lifecycle, and security boundaries semantically; never select an entire side of a conflict wholesale.

## Omnibus #8 overlap warning

PR #8 is a draft release aggregate, not the recommended Cafe review unit. It contains Auto Nudge, Idle Thread Guard, Matrix modes, telemetry, profiles, media, camera, LM Studio, and early cowork/database-contract work in one large branch.

- Do not merge #8 and then merge #13, #14, #17, or #20: cowork contracts, architecture, authorization, event admission, event persistence, database coordination, membership, and device-authority surfaces overlap or share migration lineage.
- Do not merge #13/#14/#17/#20 and then cherry-pick equivalent cowork commits from #8.
- Do not merge #19 and then retain #8's overlapping Auto Nudge authority, migrations, projections, or renderer coordinator changes.
- Do not infer that #8 completes the user-visible cowork suite. Its own description leaves server-authoritative database admission, engine-specific snapshot adapters, secure replica materialization, network transport, and UI as later work.
- Prefer extracting a narrow, independently gated PR from #8 for each non-cowork feature family that Cafe maintainers want.

## Validation gates

At this snapshot GitHub reported no configured checks for PRs #13 through #20. `MERGEABLE/CLEAN` describes branch topology, not test evidence; Cafe maintainers must run the recorded local gates (or equivalent CI) on the exact adopted heads.

Run the repository gates after each meaningful stack layer and again at the final exact head:

```sh
corepack yarn fmt
corepack yarn lint
corepack yarn typecheck
corepack yarn test
corepack yarn build:desktop
git diff --check
```

`build:desktop` is required for this ladder because #2 and later aggregate layers touch Electron, backend bootstrap, provider startup, or bundled boundaries. Also retain the focused evidence advertised by each PR:

- #3: shared model-catalog regression tests;
- #4 and #7: Matrix, provider activity, steering, Auto Nudge, browser, and contracts tests;
- #13: collaboration contracts, authorization, event admission, event-store, migration, replay, revocation, and corruption tests;
- #14: concurrent lease acquisition, fencing, compare-and-swap publication, idempotency/principal binding, and file-backed SQLite concurrency tests;
- #17: server-clock expiry, digest-only secrets, actor-bound idempotency, one-time redemption, role ceilings, membership epoch changes, corruption handling, and two-client redemption tests;
- #20: audited device authority 40/40, full repository tests, actor/epoch-bound receipts, rotate/revoke races, timestamp corruption, and adversarial low-order Ed25519 key rejection;
- #18: audited Matrix/settings units 133/133, focused Chromium 46/46, full Chromium 281/281, WebGL limits/context/fallback coverage, and full repository tests;
- #19: audited authority 96/96, browser 11/11, engine 19/19, full repository tests, and controlled proof that timer/minute/countdown state cannot authorize dispatch;
- #15: current-snapshot availability and simulated telemetry-outage browser regressions.

A green exit code is not enough for generated or packaged work. Verify that expected bundles/artifacts were freshly produced and contain the intended feature markers before publishing the adopted head.

## Security and scope boundaries

The narrow cowork ladder intentionally does not expose the existing server-wide orchestration RPC to remote members. #13 and #20 open no network endpoint, retain no private key, and mutate no shared project files. Future slices must preserve project-scoped authorization, current-membership and current-device-key checks, server-clock decisions, exact idempotency, revocation handling, bounded replay, recoverable deletion, managed-replica filesystem containment, and fail-closed corruption behavior.

Database files require a separate coordination policy. Prefer an authenticated external database service; otherwise use private per-operator forks plus immutable consistent snapshots. A serialized shared head is compatibility-only and requires a server-authoritative lease, monotonically increasing fencing token, and compare-and-swap publication. Never synchronize live SQLite pages or WAL/SHM/journal sidecars, DuckDB WAL files, or LMDB lock files between operators.
