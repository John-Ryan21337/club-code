# Adopting Club Code changes in Cafe Code

This guide is for Cafe Code maintainers who want to review or adopt Club Code changes without pulling in the entire local-release branch. It records the published GitHub state observed on 2026-08-01. Re-check each pull request's head SHA and mergeability immediately before landing it; stacked branch state can change after this snapshot.

## Published PR inventory

The repository has published 34 pull requests:

- twenty-six open implementation PRs: [#2](https://github.com/John-Ryan21337/club-code/pull/2), [#3](https://github.com/John-Ryan21337/club-code/pull/3), [#4](https://github.com/John-Ryan21337/club-code/pull/4), [#7](https://github.com/John-Ryan21337/club-code/pull/7), [#8](https://github.com/John-Ryan21337/club-code/pull/8), [#13](https://github.com/John-Ryan21337/club-code/pull/13), [#14](https://github.com/John-Ryan21337/club-code/pull/14), [#15](https://github.com/John-Ryan21337/club-code/pull/15), [#17](https://github.com/John-Ryan21337/club-code/pull/17), [#18](https://github.com/John-Ryan21337/club-code/pull/18), [#19](https://github.com/John-Ryan21337/club-code/pull/19), [#20](https://github.com/John-Ryan21337/club-code/pull/20), [#21](https://github.com/John-Ryan21337/club-code/pull/21), [#22](https://github.com/John-Ryan21337/club-code/pull/22), [#23](https://github.com/John-Ryan21337/club-code/pull/23), [#24](https://github.com/John-Ryan21337/club-code/pull/24), [#25](https://github.com/John-Ryan21337/club-code/pull/25), [#26](https://github.com/John-Ryan21337/club-code/pull/26), [#27](https://github.com/John-Ryan21337/club-code/pull/27), [#28](https://github.com/John-Ryan21337/club-code/pull/28), [#29](https://github.com/John-Ryan21337/club-code/pull/29), [#30](https://github.com/John-Ryan21337/club-code/pull/30), [#31](https://github.com/John-Ryan21337/club-code/pull/31), [#32](https://github.com/John-Ryan21337/club-code/pull/32), [#33](https://github.com/John-Ryan21337/club-code/pull/33), and [#34](https://github.com/John-Ryan21337/club-code/pull/34);
- this open documentation PR, [#16](https://github.com/John-Ryan21337/club-code/pull/16), which adds this adoption guide directly against `main`;
- four merged documentation PRs: #9 through #12;
- two closed, archived pacing PRs: #5 and #6; and
- one closed, obsolete omnibus PR: #1.

These counts describe `John-Ryan21337/club-code`, not pull requests already submitted to Cafe Code upstream. Two direct upstream drafts now reconstruct audited Club slices on current Cafe `main` after issue-first proposals:

- [cafeai/cafe-code PR #15](https://github.com/cafeai/cafe-code/pull/15), linked to [issue #14](https://github.com/cafeai/cafe-code/issues/14), recuts the audited #23 telemetry foundation at `79398c7d0a36942c525d630537e9f0980232742c` as a dependency-free six-file/899-line review unit.
- [cafeai/cafe-code PR #17](https://github.com/cafeai/cafe-code/pull/17), linked to [issue #16](https://github.com/cafeai/cafe-code/issues/16), recuts #22 into an audited five-file/715-line save/apply-only profiles slice at `bdc8f802a232b2cd14a9d1ca035c6170068e3de8`; screenshots remain required before it becomes review-ready.

The larger cowork suite has deliberately not been dumped upstream. [Cafe issue #18](https://github.com/cafeai/cafe-code/issues/18) proposes only the security-first shared-project identity, authorization, membership-epoch, and signed-event foundation and asks for maintainer direction before a third direct draft. This respects Cafe's warning that it is not actively accepting contributions, strongly prefers small focused changes, and requires UI evidence.

The active implementation foundation is:

`#2 -> #3 -> #4 -> #7`

After #7, choose one of these paths:

- **Recommended, reviewable path:** `#13 cowork foundation -> #14 database coordination -> #17 memberships/invites -> #20 device-key authority -> #21 shared chat/context`, then adopt independent child #24 (file-sync authority), #25 (transport façade), and/or #32 (injected shared operator chat UI); #26 adds audited blob storage/materialization after #24, #31 adds fenced SQLite snapshot/restore after #26, #27 adds audited task/agent authority after #24, #29 adds audited sandbox admission after #27, while #28 adds audited ephemeral project presence, #34 adds its injected roster UI, and #30 adds the default-off chat/context network adapter after #25.
- **Draft omnibus path:** `#8`, which contains the current local-release aggregate and overlaps the narrow cowork work.
- **Telemetry paths:** `#23 -> #33` is the narrow truthful CPU/RAM foundation plus UI. `#8 -> #15` is the overlapping omnibus-release follow-up. Neither is a cowork dependency; do not combine equivalent Project Resources UI changes from both paths.
- **Matrix GPU path:** `#7 -> #18`; #18 is independent of cowork and extracts WebGL2 glyph rendering plus Walk parity without Auto Nudge, provider, or server files.
- **Auto Nudge safety path:** `#7 -> #19`; #19 reconstructs dependency-complete server authority, completion-only dispatch, active-output invalidation, and restart fail-closed behavior without Idle Guard or unrelated #8 features.
- **Settings profiles path:** `#7 -> #22`; #22 is a five-file web-only extraction that excludes credentials, project paths, exact-thread Auto Nudge state, media assets, native controls, telemetry, and #15.
- **Host telemetry foundation:** `#7 -> #23`; #23 independently adds measured aggregate CPU and process-effective RAM contracts/server sampling without temperatures, GPU, project-volume probes, endpoints, polling, or graph UI.

Do not combine the cowork commits from #8 with #13, #14, #17, #20, or #21.

## Active ladder snapshot

| PR  | Purpose                                                                                 | Exact base branch                                                          | Observed head                                                                                | Snapshot state                                                    |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| #2  | Club foundation restacked on Cafe 0.146                                                 | `baseline/cafe-dev-20260729` at `77af7bcf29c512caba07a00d04c53ae9cd2c536e` | `agent/4c-default-layout` at `fde09e8e178c32f1259b138b7e5cb1074953705f`                      | open, ready, clean                                                |
| #3  | Preserve explicit Claude Opus 4.8 alias regression coverage                             | `agent/4c-default-layout`                                                  | `agent/claude-opus-5-support` at `8fb978ac7b81b95efac013765bec004d99d4243d`                  | open, ready, clean                                                |
| #4  | Matrix provider-activity link foundation                                                | `agent/claude-opus-5-support`                                              | `agent/matrix-activity-connecting-lines` at `92e56252202fbcea621b17eedacb05e4f22f3796`       | open, ready, clean                                                |
| #7  | Provider usage, completion-event-only Auto Nudge, steering safety, and Matrix hardening | `agent/matrix-activity-connecting-lines`                                   | `agent/local-priority-integration` at `a24a58f2fcbb8bc64fc95cd95ce2518a28c6f699`             | open, ready, clean after an ancestry-only restack                 |
| #13 | Secure cowork authorization, signed event admission, and durable event journal          | `agent/local-priority-integration`                                         | `feature/cowork-foundation` at `8ad2ec37e4db8464f351d67e5ad1fb99e6c29939`                    | open, ready, clean after merging the current #7 base              |
| #14 | Conflict-safe shared database coordination                                              | `feature/cowork-foundation`                                                | `feature/cowork-database-coordination` at `a3c1650a86e6b5b8c4c7f5eda716fd6d4f56e74d`         | open, ready, clean                                                |
| #17 | Secure memberships and one-time project invitations                                     | `feature/cowork-database-coordination`                                     | `feature/cowork-membership-invites` at `1973b2c1e9d4cc4b85a85077524ecd9a681639b6`            | open, ready, clean                                                |
| #20 | Audited device-key enrollment, rotation, revocation, and current-key admission          | `feature/cowork-membership-invites`                                        | `feature/cowork-device-authority` at `76957bce4c9d89d2126012b45beb37ebdc31f172`              | open, audited, clean                                              |
| #21 | Audited shared operator chat, authored prompts, and pointer-only context packets        | `feature/cowork-device-authority`                                          | `feature/cowork-chat-context-after-devices` at `036132ea0d459e867448f5427b6b704bf1c8b7a0`    | open, audited, clean                                              |
| #24 | Audited content-addressed file and fenced database-snapshot authority                   | `feature/cowork-chat-context-after-devices`                                | `feature/cowork-file-sync-authority` at `dc2fa5f2a615aa4d606ca4f6c188085dbef9e822`           | open, audited, clean; independent child of #21                    |
| #25 | Bounded authenticated collaboration transport façade                                    | `feature/cowork-chat-context-after-devices`                                | `feature/cowork-transport-facade` at `3e64125221c9209250989ea4640880b70e4da21d`              | open, gated, clean; independent child of #21                      |
| #26 | Audited quota-bounded blob storage and managed-replica materialization                  | `feature/cowork-file-sync-authority`                                       | `feature/cowork-managed-replica` at `98cf8eea891d0c65dcac1401b6258e3494916f6d`               | open, audited, clean; requires #24                                |
| #27 | Audited shared task and agent-coordination authority                                    | `feature/cowork-file-sync-authority`                                       | `feature/cowork-task-agent-authority` at `5d34d48b1687668a0c3e8ab807e6a8b35c8f255f`          | open, audited, clean; independent sibling of #26                  |
| #28 | Audited ephemeral project presence authority                                            | `feature/cowork-transport-facade`                                          | `feature/cowork-project-presence` at `eade2ca184cec4a23956fadea3ffda81d585e2e6`              | open, audited, clean; independent child of #25                    |
| #34 | Audited injected project presence roster                                                | `feature/cowork-project-presence`                                          | `feature/cowork-presence-web-roster` at `6e4abd05d6975ee389d5854c5bac1a58339740a2`           | open, audited, clean; web-only child of #28                       |
| #29 | Audited shared-agent sandbox admission                                                  | `feature/cowork-task-agent-authority`                                      | `feature/cowork-agent-sandbox-admission` at `3051ff7915355780d147043e930e1f3103711faf`       | open, audited, clean; requires #27; launches nothing              |
| #30 | Audited bounded chat/context HTTP-WebSocket adapter                                     | `feature/cowork-transport-facade`                                          | `feature/cowork-network-chat-adapter` at `1099b1c268250e5f684ef7dec119fc51363491c5`          | open, audited, clean; default-off child of #25                    |
| #31 | Audited fenced SQLite managed snapshot and restore                                      | `feature/cowork-managed-replica`                                           | `feature/cowork-sqlite-managed-snapshot` at `d1b8c4ed3e9c3a338945b9559295e961cf6364f2`       | open, audited, clean; requires #26                                |
| #32 | Audited injected shared operator chat and prompt UI                                     | `feature/cowork-chat-context-after-devices`                                | `feature/cowork-shared-operator-chat-ui` at `03ccea08c39d173770756f4150bd9cf68c1a8111`       | open, audited, clean; web-only child of #21                       |
| #22 | Audited local named Settings profiles                                                   | `agent/local-priority-integration`                                         | `feature/settings-profiles` at `8e4b7245b37905622b7bf3207e304dbbeb05537a`                    | open, audited, clean; separate from cowork and telemetry          |
| #23 | Audited truthful host CPU and process-effective RAM sampler                             | `agent/local-priority-integration`                                         | `feature/host-system-telemetry` at `b2d70cbc86d315107de1b42e3519ae89eb8012cb`                | open, audited, clean; no temperatures, GPU, endpoint, or graph UI |
| #33 | Audited truthful Project Resources CPU/RAM UI                                           | `feature/host-system-telemetry`                                            | `feature/project-resources-truthful-telemetry` at `af4921eceb2e1d42b7a10dc436344aa99a5361f6` | open, audited, clean; requires #23                                |
| #18 | WebGL2 Matrix glyph rendering and Walk parity                                           | `agent/local-priority-integration`                                         | `agent/matrix-webgl-gpu-pr` at `fa2be7e92c744440f6bf47f20174d85a4041a21d`                    | open, audited, clean; separate from the cowork ladder             |
| #19 | Completion-only Auto Nudge server authority                                             | `agent/local-priority-integration`                                         | `feature/auto-nudge-server-authority` at `99cb7fe621bbe62443d5b07e4a264a42ba0a47a7`          | open, audited, clean; overlaps #8 Auto Nudge                      |
| #8  | Aggregate current local release                                                         | `agent/local-priority-integration`                                         | `release/local-20260728` at `457be1418541bfb0ab08ae5bf9aac8a729ead23f`                       | open draft; GitHub reported `CONFLICTING/DIRTY` at this snapshot  |
| #15 | Hide stale unavailable Project Resources sensor graphs                                  | `release/local-20260728`                                                   | `work/profiles-telemetry-safety` at `9270cc56ffd05132f3ca02bce1582860850c8f0a`               | open, ready, clean; separate from the cowork ladder               |

PR #7 was restacked on the current #4 head with a normal non-force merge whose tree is identical to its prior head; GitHub reported it `MERGEABLE/CLEAN` after focused and full gates passed. Re-check rather than treating that observation as immutable if any base moves again. The same rule applies to #8 if the omnibus path is deliberately chosen. PRs #13, #14, #17, #20, #21, #24, #25, #26, #27, #28, #29, #30, #31, #32, #33, and #34 were also `MERGEABLE/CLEAN` after the #7 restack.

## Recommended merge order

1. Land #2 on the pinned Cafe baseline, or semantically rebase its delta onto the Cafe target selected by the maintainers.
2. Land #3 on #2.
3. Land #4 on #3.
4. Land the repaired #7 on the current #4 head.
5. Land #13 on the repaired #7 head.
6. Land #14, the narrow database-coordination PR, on #13.
7. Land #17, the secure memberships/invitations PR, on #14. It owns migration 072 after #14's database migration 071.
8. Land #20, the audited device-key authority PR, on #17. It owns migration 073 and binds event admission to the member's current non-revoked Ed25519 key.
9. Land #21, the audited shared chat/context PR, on #20. It owns migration 074 and stores only explicit operator-authored shared text plus pointer-only context packets.
10. Land #24, #25, and/or #32 on #21. They are independent siblings: #24 owns file/database publication authority; #25 owns a transport-neutral authenticated façade and opens no listener; #32 owns an injected-only web transcript/composer and opens no transport.
11. After #24, independently choose #26 for managed file bytes/materialization, #27 for task/agent authority, or both in either order. Neither depends on #25. After #27, optionally land #29 for admission-only shared-agent sandbox policy; it still launches nothing.
12. After #25, optionally land #28 for bounded ephemeral project presence and then #34 for its injected web roster; and/or land #30 for the default-off bounded chat/context network adapter. After #26, optionally land #31 for fenced SQLite snapshot/restore. Production resolver/TLS/launcher wiring, cross-process SQLite exclusion, durable operation receipts, actual agent execution, and full product composition remain later reviewed work.

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

# PR #22: independent five-file Settings profiles extraction on #7.
git cherry-pick eb07f8be b12dec8b a2b1086b 8e4b7245

# PR #23: independent host telemetry contracts/server sampler on #7.
git cherry-pick ec99821f f8a88f50 138a1a02 b2d70cbc

# PR #13: the contiguous pre-restack cowork foundation series.
git rev-list --reverse 8dc05d58f6457a0a31e14215d3617a9af9aa7760^..375849ce173ce81c90aad62e1bf958f3ef470917 | git cherry-pick --stdin

# PR #14: the contiguous database-coordination series.
git rev-list --reverse a48d9c93aac6e34579e1571289bc37389a216edd^..a3c1650a86e6b5b8c4c7f5eda716fd6d4f56e74d | git cherry-pick --stdin

# PR #17: membership/invitations plus its independent audit repair.
git cherry-pick dfc14718 1973b2c1

# PR #20: device authority plus its independent cryptographic audit repair.
git cherry-pick 6227e02c 76957bce

# PR #21: shared chat/context store plus its independent audit repair.
git cherry-pick d1e9ae06 036132ea

# PR #24: content-addressed file authority plus its independent audit repair.
git cherry-pick 1c764de9 dc2fa5f2

# PR #25: independent bounded transport facade. Apply after #21, with or without #24.
git cherry-pick 3e641252

# PR #26: managed blob storage/materialization plus independent audit. Apply after #24.
git cherry-pick b0862961 98cf8eea

# PR #27: task/agent authority plus independent audit. Apply after #24, with or without #26.
git cherry-pick 83b9d2a2 5d34d48b

# PR #28: ephemeral project presence plus independent audit. Apply after #25.
git cherry-pick c9ac4fbe eade2ca1

# PR #29: shared-agent sandbox admission plus independent audit. Apply after #27.
git cherry-pick 0d6ff6d6 3051ff79

# PR #30: default-off bounded chat/context network adapter. Apply after #25.
git cherry-pick 59c83a6a 1099b1c2

# PR #31: fenced SQLite managed snapshots plus independent audit. Apply after #26.
git cherry-pick b97fbd95 d1b8c4ed

# PR #32: injected shared operator chat UI. Apply after #21.
git cherry-pick 03ccea08

# PR #33: truthful Project Resources CPU/RAM UI plus independent audit. Apply after #23.
git cherry-pick 44030cee af4921ec

# PR #34: injected project presence roster plus independent audit. Apply after #28.
git cherry-pick 0fae9951 6e4abd05
```

Do not cherry-pick `8fb978ac` or `92e56252` after PR #2: both are branch-local copies of the same completion-event-only Auto Nudge cleanup already present as `fde09e8e`. PR #7's published `a24a58f2` restack commit changes ancestry only, so the curated semantic range intentionally ends at `cdb4e156`. Do not cherry-pick PR #13's final merge commit `8ad2ec37`; apply the contiguous cowork series shown above after #7 instead.

PR #15 is a separate one-commit telemetry follow-up. Cherry-pick `9270cc56ffd05132f3ca02bce1582860850c8f0a` only into a tree that already contains #8's Project Resources implementation; it is not part of the cowork sequence.

PR #18 is a Matrix-only side branch on #7. Prefer merging the reviewed PR; if cherry-picking, preserve its commit order and rerun its contracts, Matrix unit, Chromium, type, and full repository gates.

PR #19 is the reviewable Auto Nudge path after #7. Do not combine it with #8's overlapping Auto Nudge implementation. Its larger coherent surface is required because PR #7 did not yet contain server-authoritative dispatch contracts, projections, migrations, manual-FIFO priority, or restart hydration.

PR #20 continues the cowork ladder after #17. Its audit rejects low-order and identity Ed25519 public keys rather than relying on the runtime verifier alone; preserve that validation when adapting the cryptography layer.

PR #21 continues after #20. It contains shared operator-authored chat/prompts and pointer-only context packets, not private messages, provider output, reconstructed prompt bodies, endpoints, subscriptions, or UI.

PR #24 is an independent child of #21. It owns content-addressed versions, recoverable tombstones, portable path authority, compare-and-swap heads, and fenced consistent database-snapshot provenance. It does not implement blob transport/quotas or the no-follow filesystem materializer and never merges live database pages or volatile sidecars.

PR #25 is another independent child of #21. It provides resolver-only authenticated admission, membership/device rechecks, encrypted project-bound cursors, keyed audit references, and bounded replay/backpressure/cancellation. It opens no listener or socket and exposes no orchestration RPC.

PR #26 continues only the #24 file-authority path. It provides quota-bounded content-addressed blob bytes and a no-follow managed-replica materializer with recoverable tombstone moves, atomic staging/replacement, crash cleanup, filesystem identity defenses, and post-commit rollback. It still opens no network listener and leaves cross-process locking and remote non-transactional revocation linearizability as explicit future boundaries.

PR #27 is an independent sibling of #26 after #24. It provides bounded operator-authored tasks, explicit ownership and state transitions, dependency integrity, CAS revisions/fences, membership-epoch-bound agent leases, one active lease per task, an eight-agent project cap, current authority rechecks, and bounded hash-chained audit. It does not execute providers or agents and opens no network listener or orchestration RPC.

PR #28 is an independent child of #25. It provides current-authority-checked, server-clock, in-memory project presence with opaque sessions, coarse capabilities, bounded snapshot/delta replay, session-bound nonblocking subscriptions, request-bound idempotency, revocation purging, and project-isolated HMAC audit references. It starts no timer, listener, socket, RPC, file/database sync, task runner, provider, or UI.

PR #29 continues only the #27 task/agent path. It defines a managed-replica-only filesystem policy, sanitized environment, default-deny public-only network allowlists, resource/output quotas, OS-isolation attestation, current-authority rechecks, and exact termination acknowledgements. Every admission returns `launch: not-started`; it contains no executor, runner backend, listener, RPC, UI, process launch, or client integration.

PR #30 is another independent child of #25. It adds a default-off, loopback-first HTTP/WebSocket adapter for chat/context façade operations with explicit non-loopback TLS/HTTPS-origin opt-in, exact Host/Origin policy, resolver-only identity, per-frame device proof, per-source and global occupancy limits, bounded queues/rates/replay, cancellation, heartbeat, slow-consumer closure, and drain shutdown. It is not wired to the production launcher/client and exposes no orchestration RPC, files, databases, tasks, agents, providers, presence, or UI.

PR #31 continues only the #26 managed-replica path. It performs online SQLite backup into a WAL-consolidated immutable artifact and quiescence-gated atomic restore with exact membership/device-key/lease/fence/head checks, conflict-fork preservation, case-insensitive sidecar rejection, filesystem identity revalidation, integrity/schema/version/hash validation, recovery rollback, and retained-storage quotas. It does not merge database pages, expose a network endpoint, or claim restart-durable idempotency; production wiring still requires cross-process exclusion and durable request receipts.

PR #32 is an independent web-only child of #21. It adds an injected shared operator chat/authored-prompt transcript and composer with bounded cursor paging, exact-ID retry/conflict states, tombstone suppression, pointer-only context summaries, lifecycle cancellation, and accessibility coverage. A null client renders nothing; it performs no fetch, socket, RPC, timer, provider/agent launch, or live-client wiring and renders no private/provider bodies.

PR #22 is an independent five-file web child of #7. Its profile allowlist explicitly excludes credentials, provider/network security, private project paths, exact-thread Auto Nudge state, legacy minute fields, media assets, native controls, pacing, telemetry, and PR #15.

PR #23 is an independent contracts/server child of #7. It reports only measurements available through the bounded Node runtime adapter. CPU/RAM temperatures, GPU, storage temperatures, fans, RGB, project-volume probes, RPC exposure, renderer polling, and graph UI remain deferred and must not be inferred from its unavailable values.

PR #33 is the narrow web/client-runtime child of #23. It strictly decodes, bounds, and normalizes only measured aggregate CPU and process-effective RAM; preserves measured zero; turns unavailable/invalid values into graph gaps; provides true single-flight lifecycle-safe polling through an injected client; and makes Hide unavailable metrics remove unavailable cards. It adds no production endpoint/client wiring and continues to make no temperature, GPU, disk, fan, RGB, or project-volume claim.

PR #34 is the injected web-only child of #28. It requires an authoritative snapshot before accepting deltas, clears stale people on gaps/revocation/errors, binds callbacks to the current project generation, cleans subscriptions exactly once, rejects duplicate/out-of-order/oversized rosters, and presents only current coarse presence. A null client renders nothing; it starts no timer or network primitive, persists no activity history, and is not wired into the live client.

When adopting onto a newer Cafe target instead of the pinned baseline, treat these commands as an ordering manifest, not a promise of conflict-free application. Resolve migrations, settings schemas, provider lifecycle, and security boundaries semantically; never select an entire side of a conflict wholesale.

## Omnibus #8 overlap warning

PR #8 is a draft release aggregate, not the recommended Cafe review unit. It contains Auto Nudge, Idle Thread Guard, Matrix modes, telemetry, profiles, media, camera, LM Studio, and early cowork/database-contract work in one large branch.

- Do not merge #8 and then merge #13, #14, #17, #20, #21, #24, #25, #26, #27, #28, #29, #30, #31, #32, or #34: cowork contracts, architecture, authorization, event admission, event persistence, database coordination, membership, device authority, authored-context, file-authority, materialization, task authority, sandbox policy, transport, presence, network-adapter, SQLite-snapshot, shared-chat UI, and presence-roster surfaces overlap or share migration lineage.
- Do not merge #13/#14/#17/#20/#21/#24/#25/#26/#27/#28/#29/#30/#31/#32/#34 and then cherry-pick equivalent cowork commits from #8.
- Do not merge #19 and then retain #8's overlapping Auto Nudge authority, migrations, projections, or renderer coordinator changes.
- Do not infer that #8 completes the user-visible cowork suite. Its own description leaves server-authoritative database admission, engine-specific snapshot adapters, secure replica materialization, network transport, and UI as later work.
- Do not combine #33 with #8/#15's equivalent Project Resources UI changes; #33 is the narrow path after #23.
- Prefer extracting a narrow, independently gated PR from #8 for each non-cowork feature family that Cafe maintainers want.

## Validation gates

At this snapshot GitHub reported no configured checks for the newly published PRs through #34. `MERGEABLE/CLEAN` describes branch topology, not test evidence; Cafe maintainers must run the recorded local gates (or equivalent CI) on the exact adopted heads.

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
- #21: audited chat/context 20/20, full repository tests, principal-bound receipts, tombstone replay revocation, conservative token admission, membership recheck, corruption, and two-client ordering;
- #24: audited file authority 19/19, typecheck 9/9, full repository tests 9/9 with server 1,685 passed/1 skipped, database provenance, rehashed-substitution, case-fold alias, root replacement/hardlink, and bounded-head adversarial coverage;
- #25: transport façade 10/10, typecheck 9/9, full repository tests 9/9 with server 1,680 passed/1 skipped, membership/device pre/post checks, cursor binding, concurrency/backpressure, cancellation, and slow-consumer coverage;
- #26: collaboration 135/135 with focused blob/materializer 24/24, typecheck 9/9, isolated full repository tests 9/9 with server 1,703 passed/1 skipped, short-write/cancellation/quota/hash-open/current-head/tombstone/crash-recovery/filesystem-escape adversarial coverage;
- #27: focused contracts 3/3 and store/migration 12/12, typecheck 9/9, full repository tests 9/9 with server 1,697 passed/1 skipped, revocation/precommit/lease-epoch/dependency/clock/capacity/audit-substitution/Unicode/private-path adversarial coverage;
- #28: focused contracts 2/2 and presence authority 9/9, typecheck 9/9, full repository tests 9/9 with server 1,689 passed/1 skipped, request-binding/project-cap/subscription-detachment/defensive-copy/revocation/HMAC adversarial coverage;
- #29: focused contracts 5/5 and sandbox admission 6/6, typecheck 9/9, full repository tests 9/9 with server 1,703 passed/1 skipped, mutable-policy/key-byte-swap/clock-rollback/oversized-toolchain/termination adversarial coverage;
- #30: focused network adapter 12/12, typecheck 9/9, full repository tests 9/9 with server 1,692 passed/1 skipped, Host/Origin/TLS/auth/replay/per-source-occupancy/backpressure/cancellation/shutdown adversarial coverage;
- #31: focused SQLite adapter 7/7 and contracts 3/3, typecheck 9/9, full repository tests 9/9 with server 1,710 passed/1 skipped and contracts 195 passed, device-key replacement/clock-rollback/uppercase-sidecar/storage-quota/target-revalidation/conflict-fork/rollback adversarial coverage;
- #32: focused model 5/5 and Chromium 7/7, web typecheck, repository format/lint, full typecheck 9/9, full repository tests 9/9 with server 1,670 passed/1 skipped, pagination/idempotent-retry/project-switch/tombstone/privacy/accessibility coverage;
- #33: client runtime 5/5, UI model 4/4, Chromium 10/10, full typecheck 9/9, full repository tests 9/9 with server 1,604 passed/1 skipped, malformed/stale/future/nonfinite/zero/timeout/StrictMode/project-switch/privacy/hide-setting coverage;
- #34: focused model 10/10 and Chromium 4/4, focused lint/web typecheck, repository format/lint, full typecheck 9/9 and full repository tests 9/9 twice after repairs with server 1,689 passed/1 skipped, snapshot-before-delta/project-switch/revocation/gap/exact-cleanup/roster-cap/accessibility coverage, plus controlled no-timer/no-network proof;
- #22: audited profile units 23/23, Settings Chromium 41/41, full web 1,387/1,387 before final audit, full repository tests, duplicate/prototype/quota/timestamp adversarial coverage, and exhaustive private-field exclusion;
- #23: audited telemetry 44/44, typecheck 9/9, full repository tests 9/9 with server 1,604 passed/1 skipped and contracts 169 passed, truthful warming/unavailable states, overflow and relational-arithmetic guards, counter-failure and topology-change coverage, and no fabricated sensor measurements;
- #18: audited Matrix/settings units 133/133, focused Chromium 46/46, full Chromium 281/281, WebGL limits/context/fallback coverage, and full repository tests;
- #19: audited authority 96/96, browser 11/11, engine 19/19, full repository tests, and controlled proof that timer/minute/countdown state cannot authorize dispatch;
- #15: current-snapshot availability and simulated telemetry-outage browser regressions.

A green exit code is not enough for generated or packaged work. Verify that expected bundles/artifacts were freshly produced and contain the intended feature markers before publishing the adopted head.

## Security and scope boundaries

The narrow cowork ladder intentionally does not expose the existing server-wide orchestration RPC to remote members. #13, #20, #21, #24, #25, #26, #27, #28, #29, #31, #32, and #34 open no network endpoint or listener and retain no private key. #30 is the first bounded network adapter: it remains default-off and loopback-first, and non-loopback binding requires explicit opt-in, TLS, and exact HTTPS Origin policy. #26 materializes only inside its managed replica after #24 authority; it never grants remote access to an arbitrary operator workspace. #31 snapshots/restores only an already-authorized managed SQLite replica and never synchronizes live pages or sidecars. #32 and #34 remain injected-only and unreachable until an adopter deliberately composes a client. #27 grants no provider or agent execution authority. #28 is ephemeral and retains no durable activity history. #29 admits policy only and launches no process. #30 routes chat/context only and exposes no orchestration RPC, file/database sync, task/agent/provider execution, or UI. Future slices must preserve project-scoped authorization, current-membership and current-device-key checks, server-clock decisions, exact idempotency, revocation handling, bounded replay, recoverable deletion, managed-replica filesystem containment, fenced task/agent claims, attested isolation, strict network admission/backpressure, and fail-closed corruption behavior.

Database files require a separate coordination policy. Prefer an authenticated external database service; otherwise use private per-operator forks plus immutable consistent snapshots. A serialized shared head is compatibility-only and requires a server-authoritative lease, monotonically increasing fencing token, and compare-and-swap publication. Never synchronize live SQLite pages or WAL/SHM/journal sidecars, DuckDB WAL files, or LMDB lock files between operators.
