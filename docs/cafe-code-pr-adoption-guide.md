# Adopting Club Code changes in Cafe Code

This guide is for Cafe Code maintainers who want to review or adopt Club Code changes without pulling in the entire local-release branch. It records the published GitHub state observed on 2026-08-01. Re-check each pull request's head SHA and mergeability immediately before landing it; stacked branch state can change after this snapshot.

## Instructions for Cafe Code developers and coding agents

The parity reference for this snapshot is Club Code `release/local-20260728` at `47961f979b1e10e9f05993631dac1136b666fabe`. Treat that release as evidence of the intended combined behavior, not as a branch to merge wholesale. The review units below are the source of truth for adopting individual capabilities.

Use this operating instruction when assigning the upgrade to an LLM coding agent:

> Upgrade Cafe Code toward the documented Club Code parity target one reviewable feature slice at a time. Start from a clean branch based on the Cafe maintainer's selected current commit, read the target repository's instructions, and re-check the selected Club PR's base, head, diff, tests, and mergeability. Do not merge or cherry-pick omnibus PR #8. Select exactly one feature lane below, bring over its prerequisites in order, and port the semantic change rather than blindly resolving ancestry conflicts. Preserve Cafe's current architecture and naming where upstream has moved. Keep contracts, server authority, storage, transport, UI, and production composition as separate commits or PRs whenever the source ladder separates them. Run deterministic focused tests after each slice and the full repository gates before publishing. Do not claim a UI is operational until its authority and production adapter are deliberately composed. Do not add timers, polling, automatic reconnect, public listeners, remote orchestration, arbitrary workspace access, or private-key exposure unless a reviewed source slice explicitly authorizes that capability. Stop and report if a prerequisite is missing, a security invariant cannot be preserved, the target base invalidates the source design, or new maintainer authority is required.

### Install the Club Code reference build

Before comparing behavior, install the exact Club Code reference on a separate checkout. [PR #50](https://github.com/John-Ryan21337/club-code/pull/50) adds copy-paste Codex/Claude Code setup instructions to the README for macOS Intel/Apple Silicon, Windows 10/11 x64/ARM64, Arch Linux x64/ARM64, and Raspberry Pi 5 on a 64-bit ARM64 desktop OS. It directs the agent to `release/local-20260728`, currently verified at `47961f979b1e10e9f05993631dac1136b666fabe`, instead of treating `main` as the combined-build parity target.

The install agent must ask before elevation, package or `PATH` changes, firewall exposure, or checkout replacement; preserve existing `.cafe-code` state and credentials; use Node 24.13.1 plus the pinned Yarn 4.17.1; and verify that a real Club Code window launches. Raspberry Pi 5 remains experimental source-only because published Linux artifacts are x64-only. A Pi agent must use native ARM64 Node and report Electron, native-module, GPU, or memory limitations rather than claiming the x64 AppImage is compatible.

### Piece-by-piece parity plan

Each row is a separately reviewable lane. Finish and validate one row before starting another unless Cafe maintainers explicitly approve a stacked series.

| Step | Capability                    | Adopt in this order                                                                                                                                                                                               | Parity checkpoint                                                                                                                                                                                                                                           |
| ---- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Shared foundation             | #2 -> #3 -> #4 -> #7, or semantically reconstruct only the needed foundation on current Cafe `main`                                                                                                               | Provider/model aliases, Matrix activity links, provider usage, completion-event-only Auto Nudge foundations, and shared settings/contracts compile on the current Cafe base.                                                                                |
| 1A   | Auto Nudge safety             | #7 -> #19                                                                                                                                                                                                         | Dispatch authority is completion-event-only; active output, restarts, elapsed time, countdowns, and minute fields cannot authorize a nudge. Idle Thread Guard remains a separate opt-in feature.                                                            |
| 1B   | GPU Matrix                    | #7 -> #18                                                                                                                                                                                                         | WebGL2 glyph rendering and Walk Forward/Reverse parity work with bounded fallback and no Auto Nudge/server coupling.                                                                                                                                        |
| 1C   | Settings profiles             | #7 -> #22 -> #35                                                                                                                                                                                                  | Allowlist-only local profiles support save/apply, inspect-before-load preview, and conflict-safe deletion without credentials, paths, or exact-thread automation state.                                                                                     |
| 1D   | Japanese and dual-language UI | Reconstruct the renderer-local language preference and safe localization provider from release commit `b5e20ab3`; keep automation prompt localization dependent on the corresponding Auto Nudge/Idle Guard feature slice | English, Japanese, and side-by-side dual display cover first-party UI only. Transcripts, operator prompts, paths, code, provider output, and dynamic project content are never machine-translated. A language change cannot enable, arm, reset, retry, or dispatch automation. |
| 1E   | Truthful resources            | #7 -> #23 -> #33                                                                                                                                                                                                  | CPU and effective RAM measurements distinguish warming/unavailable from zero, graph unavailable values as gaps, and actually hide unavailable cards. Do not combine this with the overlapping #8/#15 route.                                                 |
| 2    | Cowork trust core             | #13 -> #14 -> #17 -> #20 -> #21                                                                                                                                                                                   | Project-scoped authorization, signed admission, durable journal, fenced database publication, membership epochs, one-time invitations, current device keys, shared operator chat, and pointer-only context exist without a public network listener.         |
| 3    | Membership and device UX      | After #17: #38 -> #40 -> #42. After #20: #43 and #45 -> #46                                                                                                                                                       | Invitation secrets remain ephemeral, private key operations remain behind an opaque signer, and status/self-revoke exposes only the authenticated current device.                                                                                           |
| 4    | Files and databases           | After #21: #24 -> #26; then choose #31 and/or #37 -> #41                                                                                                                                                          | Files are content-addressed and materialize only inside managed replicas. SQLite moves through consistent fenced snapshots; never synchronize live database pages, WAL, SHM, journal, or lock files. Approval receipts do not claim that an apply occurred. |
| 5A   | Shared tasks and sandboxing   | #24 -> #27; then choose #29 and/or #36                                                                                                                                                                            | Task ownership, dependencies, revisions, fences, and admission evidence are available, but neither authority nor UI launches an agent. Execution needs a later separately reviewed capability.                                                              |
| 5B   | Presence                      | #21 -> #25 -> #28 -> #34                                                                                                                                                                                          | Presence is bounded, ephemeral, project-scoped, snapshot-first, and retains no activity history.                                                                                                                                                            |
| 6    | Authenticated chat networking | #21 -> #25 -> #30 -> #47. Add #32 -> #39 -> #44 for chat/prompt UI. After exact siblings exist, add #48 for current-device controls and #49 for shared chat.                                                      | The client is explicitly connected and default-disconnected. There is no polling, timer, automatic reconnect, credential persistence, public listener, file/database/task/provider route, or general orchestration RPC.                                     |
| 7    | Release-only extraction queue | Use #8 only as a comparison source; extract separate PRs for Idle Thread Guard, ambient/media/camera controls, LM Studio integration, and any other release-only UI. Use #15 only on the omnibus telemetry route. | Each capability has its own current-Cafe PR, tests, screenshots for UI work, security boundaries, and no copied overlap with the narrow lanes above. Only then claim full latest-build parity.                                                              |

### Localization extraction boundary

### Localization extraction boundary

Club Code release commit `b5e20ab3` is the behavioral reference, but it is not a clean Cafe cherry-pick because it also localizes Club-only Auto Nudge and Idle Thread Guard controls. Recut it on current Cafe `main` in three review units: (1) the persisted `system` / `en` / `ja` / `dual` preference and localization provider, (2) static first-party UI catalogs with dynamic/transcript/code exclusions, and only after the matching automation features exist, (3) authored localized built-in prompt variants. Preserve custom prompts byte-for-byte. Dual mode must not translate or duplicate transcript context, and changing language must have no authority side effect.

Use `docs/ui-localization-canon.md` at release head `47961f97` as the safety contract. Do not copy the release commit wholesale and do not add a runtime machine-translation/network dependency.
### Agent execution loop for every slice

1. Record the exact Cafe target SHA and the Club source PR base/head SHAs.
2. Inspect the source PR's changed files, commits, description, tests, and parent dependencies. Never infer a dependency solely from its PR number.
3. Create one target branch for the selected slice. Prefer a semantic port when Cafe has changed since the pinned baseline; use the curated cherry-picks below only when their ancestry still applies exactly.
4. Add or port the narrowest contract first, then authority/storage, then adapter, then injected UI, then production composition. Do not collapse security boundaries merely to reduce commit count.
5. Preserve idempotency keys, membership/device epoch checks, server-clock decisions, bounded cursors and payloads, cancellation, revocation, fencing, path containment, and fail-closed decoding from the source slice.
6. Run the source PR's focused tests and Cafe's formatter, linter, typecheck, full tests, and desktop build when packaging/backend/provider boundaries changed. Verify the intended runtime or artifact effect instead of trusting exit code alone.
7. Publish as a draft first with the Club source PR, exact source SHA, target SHA, dependency list, validation evidence, screenshots where applicable, and explicit deferred capabilities in the description.
8. Rebase or restack only after the parent slice moves; then rerun the gates on the new exact head. Never merge equivalent work from both #8 and the narrow ladder.

Full parity is not a single merge. It is achieved only when every chosen lane's parity checkpoint passes on Cafe's current base and the remaining release-only features have been extracted into similarly bounded reviews.

## Published PR inventory

The repository has published 50 pull requests:

- forty-one open implementation PRs: [#2](https://github.com/John-Ryan21337/club-code/pull/2), [#3](https://github.com/John-Ryan21337/club-code/pull/3), [#4](https://github.com/John-Ryan21337/club-code/pull/4), [#7](https://github.com/John-Ryan21337/club-code/pull/7), [#8](https://github.com/John-Ryan21337/club-code/pull/8), [#13](https://github.com/John-Ryan21337/club-code/pull/13), [#14](https://github.com/John-Ryan21337/club-code/pull/14), [#15](https://github.com/John-Ryan21337/club-code/pull/15), [#17](https://github.com/John-Ryan21337/club-code/pull/17), [#18](https://github.com/John-Ryan21337/club-code/pull/18), [#19](https://github.com/John-Ryan21337/club-code/pull/19), [#20](https://github.com/John-Ryan21337/club-code/pull/20), [#21](https://github.com/John-Ryan21337/club-code/pull/21), [#22](https://github.com/John-Ryan21337/club-code/pull/22), [#23](https://github.com/John-Ryan21337/club-code/pull/23), [#24](https://github.com/John-Ryan21337/club-code/pull/24), [#25](https://github.com/John-Ryan21337/club-code/pull/25), [#26](https://github.com/John-Ryan21337/club-code/pull/26), [#27](https://github.com/John-Ryan21337/club-code/pull/27), [#28](https://github.com/John-Ryan21337/club-code/pull/28), [#29](https://github.com/John-Ryan21337/club-code/pull/29), [#30](https://github.com/John-Ryan21337/club-code/pull/30), [#31](https://github.com/John-Ryan21337/club-code/pull/31), [#32](https://github.com/John-Ryan21337/club-code/pull/32), [#33](https://github.com/John-Ryan21337/club-code/pull/33), [#34](https://github.com/John-Ryan21337/club-code/pull/34), [#35](https://github.com/John-Ryan21337/club-code/pull/35), [#36](https://github.com/John-Ryan21337/club-code/pull/36), [#37](https://github.com/John-Ryan21337/club-code/pull/37), [#38](https://github.com/John-Ryan21337/club-code/pull/38), [#39](https://github.com/John-Ryan21337/club-code/pull/39), [#40](https://github.com/John-Ryan21337/club-code/pull/40), [#41](https://github.com/John-Ryan21337/club-code/pull/41), [#42](https://github.com/John-Ryan21337/club-code/pull/42), [#43](https://github.com/John-Ryan21337/club-code/pull/43), [#44](https://github.com/John-Ryan21337/club-code/pull/44), [#45](https://github.com/John-Ryan21337/club-code/pull/45), [#46](https://github.com/John-Ryan21337/club-code/pull/46), [#47](https://github.com/John-Ryan21337/club-code/pull/47), [#48](https://github.com/John-Ryan21337/club-code/pull/48), and [#49](https://github.com/John-Ryan21337/club-code/pull/49);
- this open documentation PR, [#16](https://github.com/John-Ryan21337/club-code/pull/16), which adds the adoption guide;
- five merged documentation PRs: #9 through #12, plus [#50](https://github.com/John-Ryan21337/club-code/pull/50), which added the agent-friendly cross-platform setup guide;
- two closed, archived pacing PRs: #5 and #6; and
- one closed, obsolete omnibus PR: #1.

These counts describe `John-Ryan21337/club-code`, not pull requests already submitted to Cafe Code upstream. Two direct upstream drafts now reconstruct audited Club slices on current Cafe `main` after issue-first proposals:

- [cafeai/cafe-code PR #15](https://github.com/cafeai/cafe-code/pull/15), linked to [issue #14](https://github.com/cafeai/cafe-code/issues/14), recuts the audited #23 telemetry foundation at `79398c7d0a36942c525d630537e9f0980232742c` as a dependency-free six-file/899-line review unit.
- [cafeai/cafe-code PR #17](https://github.com/cafeai/cafe-code/pull/17), linked to [issue #16](https://github.com/cafeai/cafe-code/issues/16), recuts #22 into an audited five-file/715-line save/apply-only profiles slice at `bdc8f802a232b2cd14a9d1ca035c6170068e3de8`; screenshots remain required before it becomes review-ready.

The larger cowork suite has deliberately not been dumped upstream. [Cafe issue #18](https://github.com/cafeai/cafe-code/issues/18) proposes only the security-first shared-project identity, authorization, membership-epoch, and signed-event foundation and asks for maintainer direction before a third direct draft. This respects Cafe's warning that it is not actively accepting contributions, strongly prefers small focused changes, and requires UI evidence.

The active implementation foundation is:

`#2 -> #3 -> #4 -> #7`

After #7, choose one of these paths:

- **Recommended, reviewable path:** `#13 cowork foundation -> #14 database coordination -> #17 memberships/invites -> #20 device-key authority -> #21 shared chat/context`; optionally add #38's injected membership/revocation UI after #17, #40's one-time invitation-creation UI, and then #42's one-time redemption UI. Optionally add #43's private-key-opaque device enrollment UI and/or #45's authenticated current-device status authority after #20, then #46's injected current-device controls after #45. Then adopt independent child #24 (file-sync authority), #25 (transport façade), and/or #32 (injected shared operator chat UI), followed optionally by #39's read-only authored-prompt timeline and #44's bounded merged/side-by-side presentation after #32; #26 adds audited blob storage/materialization after #24, #31 adds fenced SQLite snapshot/restore and #37 adds read-only replica/conflict status after #26, followed optionally by #41's content-addressed publish/apply preview and approval UI; #27 adds audited task/agent authority after #24, #36 adds its injected admission-not-started task/agent UI, #29 adds audited sandbox admission after #27, while #28 adds audited ephemeral project presence, #34 adds its injected roster UI, and #30 adds the default-off chat/context network adapter after #25, followed by #47's default-disconnected authenticated client. After the exact prerequisite siblings are present, #48 composes #46 with #47 for authenticated current-device status/self-revoke, and #49 composes #32 with #47 for authenticated shared operator chat.
- **Draft omnibus path:** `#8`, which contains the current local-release aggregate and overlaps the narrow cowork work.
- **Telemetry paths:** `#23 -> #33` is the narrow truthful CPU/RAM foundation plus UI. `#8 -> #15` is the overlapping omnibus-release follow-up. Neither is a cowork dependency; do not combine equivalent Project Resources UI changes from both paths.
- **Matrix GPU path:** `#7 -> #18`; #18 is independent of cowork and extracts WebGL2 glyph rendering plus Walk parity without Auto Nudge, provider, or server files.
- **Auto Nudge safety path:** `#7 -> #19`; #19 reconstructs dependency-complete server authority, completion-only dispatch, active-output invalidation, and restart fail-closed behavior without Idle Guard or unrelated #8 features.
- **Settings profiles path:** `#7 -> #22 -> #35`; #22 is the safe local named-profile foundation, while #35 adds audited inspect-before-load preview and cross-window-safe deletion without broadening the allowlist. Both exclude credentials, project paths, exact-thread Auto Nudge state, media assets, native controls, telemetry, and #15.
- **Host telemetry foundation:** `#7 -> #23`; #23 independently adds measured aggregate CPU and process-effective RAM contracts/server sampling without temperatures, GPU, project-volume probes, endpoints, polling, or graph UI.

Do not combine the cowork commits from #8 with #13, #14, #17, #20, or #21.

## Active ladder snapshot

| PR  | Purpose                                                                                 | Exact base branch                                                          | Observed head                                                                                | Snapshot state                                                        |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| #2  | Club foundation restacked on Cafe 0.146                                                 | `baseline/cafe-dev-20260729` at `77af7bcf29c512caba07a00d04c53ae9cd2c536e` | `agent/4c-default-layout` at `fde09e8e178c32f1259b138b7e5cb1074953705f`                      | open, ready, clean                                                    |
| #3  | Preserve explicit Claude Opus 4.8 alias regression coverage                             | `agent/4c-default-layout`                                                  | `agent/claude-opus-5-support` at `8fb978ac7b81b95efac013765bec004d99d4243d`                  | open, ready, clean                                                    |
| #4  | Matrix provider-activity link foundation                                                | `agent/claude-opus-5-support`                                              | `agent/matrix-activity-connecting-lines` at `92e56252202fbcea621b17eedacb05e4f22f3796`       | open, ready, clean                                                    |
| #7  | Provider usage, completion-event-only Auto Nudge, steering safety, and Matrix hardening | `agent/matrix-activity-connecting-lines`                                   | `agent/local-priority-integration` at `a24a58f2fcbb8bc64fc95cd95ce2518a28c6f699`             | open, ready, clean after an ancestry-only restack                     |
| #13 | Secure cowork authorization, signed event admission, and durable event journal          | `agent/local-priority-integration`                                         | `feature/cowork-foundation` at `8ad2ec37e4db8464f351d67e5ad1fb99e6c29939`                    | open, ready, clean after merging the current #7 base                  |
| #14 | Conflict-safe shared database coordination                                              | `feature/cowork-foundation`                                                | `feature/cowork-database-coordination` at `a3c1650a86e6b5b8c4c7f5eda716fd6d4f56e74d`         | open, ready, clean                                                    |
| #17 | Secure memberships and one-time project invitations                                     | `feature/cowork-database-coordination`                                     | `feature/cowork-membership-invites` at `1973b2c1e9d4cc4b85a85077524ecd9a681639b6`            | open, ready, clean                                                    |
| #38 | Audited injected membership, pending-invitation, and revocation UI                      | `feature/cowork-membership-invites`                                        | `feature/cowork-membership-invite-ui` at `0a68a4115d01d8ae220d32c4db337dcf48d3e805`          | open, audited, clean; web-only child of #17; no invite creation       |
| #40 | Audited injected one-time invitation creation UI                                        | `feature/cowork-membership-invite-ui`                                      | `feature/cowork-invite-create-ui` at `5fd5223d6d737439692f620f5e2e281efa4ba681`              | open, audited, clean; web-only child of #38; token is memory-only     |
| #42 | Audited injected one-time invitation redemption UI                                      | `feature/cowork-invite-create-ui`                                          | `feature/cowork-invite-redeem-ui` at `d1cd2ef4c6144be6df1e308ed8df1d59b4ec9673`              | open, audited, clean; web-only child of #40; secret is ephemeral      |
| #20 | Audited device-key enrollment, rotation, revocation, and current-key admission          | `feature/cowork-membership-invites`                                        | `feature/cowork-device-authority` at `76957bce4c9d89d2126012b45beb37ebdc31f172`              | open, audited, clean                                                  |
| #43 | Audited injected private-key-opaque device enrollment UI                                | `feature/cowork-device-authority`                                          | `feature/cowork-device-enrollment-ui` at `e6b48d52e197f7ae09c1474cebab168e1012572c`          | open, audited, clean; web-only child of #20; signer remains opaque    |
| #45 | Audited authenticated current-device key status authority                               | `feature/cowork-device-authority`                                          | `feature/cowork-device-key-status-authority` at `672d22595b72afc1b6518cd4e6ae7ac162c225f0`   | open, audited, clean; server/contracts child of #20                   |
| #46 | Audited injected current-device status and self-revoke controls                         | `feature/cowork-device-key-status-authority`                               | `feature/cowork-device-status-ui` at `2335a4bcb514d5c6ec19e7113df457d800a092a2`              | open, audited, clean; web-only child of #45; current device only      |
| #21 | Audited shared operator chat, authored prompts, and pointer-only context packets        | `feature/cowork-device-authority`                                          | `feature/cowork-chat-context-after-devices` at `036132ea0d459e867448f5427b6b704bf1c8b7a0`    | open, audited, clean                                                  |
| #24 | Audited content-addressed file and fenced database-snapshot authority                   | `feature/cowork-chat-context-after-devices`                                | `feature/cowork-file-sync-authority` at `dc2fa5f2a615aa4d606ca4f6c188085dbef9e822`           | open, audited, clean; independent child of #21                        |
| #25 | Bounded authenticated collaboration transport façade                                    | `feature/cowork-chat-context-after-devices`                                | `feature/cowork-transport-facade` at `3e64125221c9209250989ea4640880b70e4da21d`              | open, gated, clean; independent child of #21                          |
| #26 | Audited quota-bounded blob storage and managed-replica materialization                  | `feature/cowork-file-sync-authority`                                       | `feature/cowork-managed-replica` at `98cf8eea891d0c65dcac1401b6258e3494916f6d`               | open, audited, clean; requires #24                                    |
| #37 | Audited read-only managed-replica and file-conflict status UI                           | `feature/cowork-managed-replica`                                           | `feature/cowork-file-conflict-ui` at `bc176c068dc83ed8c4962370fb8020df7012715c`              | open, audited, clean; web-only child of #26                           |
| #41 | Audited managed-replica publish/apply preview and approval UI                           | `feature/cowork-file-conflict-ui`                                          | `feature/cowork-replica-apply-preview-ui` at `11b4e6d316941b4bc784f369ba17ec4ca9cd14a8`      | open, audited, clean; web-only child of #37; receipt-only             |
| #27 | Audited shared task and agent-coordination authority                                    | `feature/cowork-file-sync-authority`                                       | `feature/cowork-task-agent-authority` at `5d34d48b1687668a0c3e8ab807e6a8b35c8f255f`          | open, audited, clean; independent sibling of #26                      |
| #36 | Audited injected shared task and agent coordination UI                                  | `feature/cowork-task-agent-authority`                                      | `feature/cowork-task-agent-ui` at `e153c720b69d40c9d33c23d53a0e9c856072821f`                 | open, audited, clean; web-only child of #27; launches nothing         |
| #28 | Audited ephemeral project presence authority                                            | `feature/cowork-transport-facade`                                          | `feature/cowork-project-presence` at `eade2ca184cec4a23956fadea3ffda81d585e2e6`              | open, audited, clean; independent child of #25                        |
| #34 | Audited injected project presence roster                                                | `feature/cowork-project-presence`                                          | `feature/cowork-presence-web-roster` at `6e4abd05d6975ee389d5854c5bac1a58339740a2`           | open, audited, clean; web-only child of #28                           |
| #29 | Audited shared-agent sandbox admission                                                  | `feature/cowork-task-agent-authority`                                      | `feature/cowork-agent-sandbox-admission` at `3051ff7915355780d147043e930e1f3103711faf`       | open, audited, clean; requires #27; launches nothing                  |
| #30 | Audited bounded chat/context HTTP-WebSocket adapter                                     | `feature/cowork-transport-facade`                                          | `feature/cowork-network-chat-adapter` at `1099b1c268250e5f684ef7dec119fc51363491c5`          | open, audited, clean; default-off child of #25                        |
| #47 | Audited default-disconnected authenticated chat/context client                          | `feature/cowork-network-chat-adapter`                                      | `feature/cowork-network-chat-client` at `0098382e870323248887cbdeb14147d98a55b5f3`           | open, audited, clean; client-runtime child of #30; no auto-retry      |
| #48 | Audited authenticated current-device status/self-revoke composition                     | `feature/cowork-network-chat-client`                                       | `feature/cowork-device-network-composition` at `82446a05125d2fbdcc4bb34bd31dabeb5ce46b3d`    | open, audited, clean; integration of #46 and #47; current device only |
| #49 | Audited authenticated shared operator chat composition                                  | `feature/cowork-network-chat-client`                                       | `feature/cowork-chat-ui-network-composition` at `c05545df7a086ea004f8fa6c08bf86dae6e29c5d`   | open, audited, clean; integration of #32 and #47; no auto-retry       |
| #31 | Audited fenced SQLite managed snapshot and restore                                      | `feature/cowork-managed-replica`                                           | `feature/cowork-sqlite-managed-snapshot` at `d1b8c4ed3e9c3a338945b9559295e961cf6364f2`       | open, audited, clean; requires #26                                    |
| #32 | Audited injected shared operator chat and prompt UI                                     | `feature/cowork-chat-context-after-devices`                                | `feature/cowork-shared-operator-chat-ui` at `03ccea08c39d173770756f4150bd9cf68c1a8111`       | open, audited, clean; web-only child of #21                           |
| #39 | Audited read-only shared authored-prompt timeline                                       | `feature/cowork-shared-operator-chat-ui`                                   | `feature/cowork-shared-prompt-timeline` at `07574a8d8039204c781169c310eef4b564258a19`        | open, audited, clean; web-only child of #32; sends nothing            |
| #44 | Audited bounded merged/side-by-side authored-prompt lanes                               | `feature/cowork-shared-prompt-timeline`                                    | `feature/cowork-shared-prompt-lanes-ui` at `06ff23203b95370725059bcc7ee184f7dc3dd727`        | open, audited, clean; web-only child of #39; read-only                |
| #22 | Audited local named Settings profiles                                                   | `agent/local-priority-integration`                                         | `feature/settings-profiles` at `8e4b7245b37905622b7bf3207e304dbbeb05537a`                    | open, audited, clean; separate from cowork and telemetry              |
| #35 | Audited safe Settings profile preview and deletion                                      | `feature/settings-profiles`                                                | `feature/settings-profiles-management` at `1d8ee249ddc91bdadad7ac5e66c322f9436f3b72`         | open, audited, clean; requires #22                                    |
| #23 | Audited truthful host CPU and process-effective RAM sampler                             | `agent/local-priority-integration`                                         | `feature/host-system-telemetry` at `b2d70cbc86d315107de1b42e3519ae89eb8012cb`                | open, audited, clean; no temperatures, GPU, endpoint, or graph UI     |
| #33 | Audited truthful Project Resources CPU/RAM UI                                           | `feature/host-system-telemetry`                                            | `feature/project-resources-truthful-telemetry` at `af4921eceb2e1d42b7a10dc436344aa99a5361f6` | open, audited, clean; requires #23                                    |
| #18 | WebGL2 Matrix glyph rendering and Walk parity                                           | `agent/local-priority-integration`                                         | `agent/matrix-webgl-gpu-pr` at `fa2be7e92c744440f6bf47f20174d85a4041a21d`                    | open, audited, clean; separate from the cowork ladder                 |
| #19 | Completion-only Auto Nudge server authority                                             | `agent/local-priority-integration`                                         | `feature/auto-nudge-server-authority` at `99cb7fe621bbe62443d5b07e4a264a42ba0a47a7`          | open, audited, clean; overlaps #8 Auto Nudge                          |
| #8  | Aggregate current local release                                                         | `agent/local-priority-integration`                                         | `release/local-20260728` at `47961f979b1e10e9f05993631dac1136b666fabe`                       | open draft; GitHub reported `CONFLICTING/DIRTY` at this snapshot      |
| #15 | Hide stale unavailable Project Resources sensor graphs                                  | `release/local-20260728`                                                   | `work/profiles-telemetry-safety` at `9270cc56ffd05132f3ca02bce1582860850c8f0a`               | open, ready, clean; separate from the cowork ladder                   |

PR #7 was restacked on the current #4 head with a normal non-force merge whose tree is identical to its prior head; GitHub reported it `MERGEABLE/CLEAN` after focused and full gates passed. Re-check rather than treating that observation as immutable if any base moves again. The same rule applies to #8 if the omnibus path is deliberately chosen. PRs #13 through #49 in the active ladder were published from clean, gated heads and GitHub reported every non-draft open PR mergeable at this snapshot. Re-check GitHub's asynchronously computed mergeability and the exact head SHA immediately before landing any slice.

## Recommended merge order

1. Land #2 on the pinned Cafe baseline, or semantically rebase its delta onto the Cafe target selected by the maintainers.
2. Land #3 on #2.
3. Land #4 on #3.
4. Land the repaired #7 on the current #4 head.
5. Land #13 on the repaired #7 head.
6. Land #14, the narrow database-coordination PR, on #13.
7. Land #17, the secure memberships/invitations PR, on #14. It owns migration 072 after #14's database migration 071. Optionally land #38 on #17 for its injected read/revoke UI, then #40 for bounded invitation creation whose one-time plaintext token exists only in the immediate in-memory response, then #42 for explicit one-time redemption without URL, clipboard, history, or storage ingestion.
8. Land #20, the audited device-key authority PR, on #17. It owns migration 073 and binds event admission to the member's current non-revoked Ed25519 key. Optionally land #43 for injected enrollment whose private key never crosses the signer boundary and/or #45 for authenticated current-device status plus the existing self-revoke authority, then #46 for the injected current-device status/self-revoke UI. #45 is server/contracts-only; #46 remains injected-only. Neither wires #43 to production transport or OS-backed key custody.
9. Land #21, the audited shared chat/context PR, on #20. It owns migration 074 and stores only explicit operator-authored shared text plus pointer-only context packets.
10. Land #24, #25, and/or #32 on #21. They are independent siblings: #24 owns file/database publication authority; #25 owns a transport-neutral authenticated façade and opens no listener; #32 owns an injected-only web transcript/composer and opens no transport. Optionally land #39 after #32 for the separately bounded, read-only authored-prompt timeline.
11. After #24, independently choose #26 for managed file bytes/materialization, #27 for task/agent authority, or both in either order. Neither depends on #25. After #27, optionally land #36 for the injected task/agent UI and/or #29 for admission-only shared-agent sandbox policy; both still launch nothing. On the independent #32 UI path, #44 follows #39 and must not be cherry-picked without its bounded timeline parent.
12. After #25, optionally land #28 for bounded ephemeral project presence and then #34 for its injected web roster; and/or land #30 for the default-off bounded chat/context network adapter, then #47 for its default-disconnected authenticated client. Once both exact sibling prerequisites are present, optionally land #48 after #46 and #47 for current-device status/self-revoke network composition, and/or #49 after #32 and #47 for shared operator chat network composition. After #26, optionally land #31 for fenced SQLite snapshot/restore and/or #37 for read-only replica/conflict status, then #41 for content-addressed publish/apply preview and explicit approval. PR #41's approval receipt is not evidence that files were applied. #48 and #49 still have no production launcher, public listener, credential/key custody, automatic reconnect, polling, timer, or file/database/task/provider route. Production resolver/TLS/launcher wiring, retained-public-key proof verification for exact post-revoke receipt replay, cross-process SQLite exclusion, actual agent execution, and broader product composition remain later reviewed work.

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

# PR #38: injected membership/invitation read-and-revoke UI plus independent audit. Apply after #17.
git cherry-pick 645346ef 0a68a411

# PR #40: one-time invitation creation UI plus independent audit. Apply after #38.
git cherry-pick 85b4570b 5fd5223d

# PR #42: one-time invitation redemption UI plus independent audit. Apply after #40.
git cherry-pick 290c0d03 d1cd2ef4

# PR #20: device authority plus its independent cryptographic audit repair.
git cherry-pick 6227e02c 76957bce

# PR #43: private-key-opaque device enrollment UI plus independent audit. Apply after #20.
git cherry-pick 634d24a8 e6b48d52

# PR #45: authenticated current-device status authority plus independent audit. Apply after #20.
git cherry-pick f4acaf3e 672d2259

# PR #46: injected current-device status/self-revoke UI plus independent audit. Apply after #45.
git cherry-pick 18123f5c 2335a4bc

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

# PR #47: default-disconnected authenticated chat/context client plus independent audit. Apply after #30.
git cherry-pick 9cfb9e0d 0098382e

# PR #48: authenticated current-device network composition. Apply only after #46 and #47.
git cherry-pick fe0bce3a 82446a05

# PR #49: authenticated shared operator chat composition. Apply only after #32 and #47.
git cherry-pick 6e384e2c c05545df

# PR #31: fenced SQLite managed snapshots plus independent audit. Apply after #26.
git cherry-pick b97fbd95 d1b8c4ed

# PR #32: injected shared operator chat UI. Apply after #21.
git cherry-pick 03ccea08

# PR #33: truthful Project Resources CPU/RAM UI plus independent audit. Apply after #23.
git cherry-pick 44030cee af4921ec

# PR #34: injected project presence roster plus independent audit. Apply after #28.
git cherry-pick 0fae9951 6e4abd05

# PR #35: safe Settings profile preview/deletion plus independent audit. Apply after #22.
git cherry-pick bdea0c89 1d8ee249

# PR #36: injected shared task/agent UI plus independent audit. Apply after #27.
git cherry-pick e3c97dfe e153c720

# PR #37: read-only managed-replica/conflict status UI plus independent audit. Apply after #26.
git cherry-pick 2fdc057b bc176c06

# PR #41: managed-replica publish/apply preview and approval UI plus independent audit. Apply after #37.
git cherry-pick ad205d8c 11b4e6d3

# PR #39: read-only shared authored-prompt timeline plus independent audit. Apply after #32.
git cherry-pick 6a9edcb9 07574a8d

# PR #44: bounded merged/side-by-side prompt lanes plus independent audit. Apply after #39.
git cherry-pick 34dac0ac 06ff2320
```

Do not cherry-pick `8fb978ac` or `92e56252` after PR #2: both are branch-local copies of the same completion-event-only Auto Nudge cleanup already present as `fde09e8e`. PR #7's published `a24a58f2` restack commit changes ancestry only, so the curated semantic range intentionally ends at `cdb4e156`. Do not cherry-pick PR #13's final merge commit `8ad2ec37`; apply the contiguous cowork series shown above after #7 instead.

PR #15 is a separate one-commit telemetry follow-up. Cherry-pick `9270cc56ffd05132f3ca02bce1582860850c8f0a` only into a tree that already contains #8's Project Resources implementation; it is not part of the cowork sequence.

PR #18 is a Matrix-only side branch on #7. Prefer merging the reviewed PR; if cherry-picking, preserve its commit order and rerun its contracts, Matrix unit, Chromium, type, and full repository gates.

PR #19 is the reviewable Auto Nudge path after #7. Do not combine it with #8's overlapping Auto Nudge implementation. Its larger coherent surface is required because PR #7 did not yet contain server-authoritative dispatch contracts, projections, migrations, manual-FIFO priority, or restart hydration.

PR #20 continues the cowork ladder after #17. Its audit rejects low-order and identity Ed25519 public keys rather than relying on the runtime verifier alone; preserve that validation when adapting the cryptography layer.

PR #21 continues after #20. It contains shared operator-authored chat/prompts and pointer-only context packets, not private messages, provider output, reconstructed prompt bodies, endpoints, subscriptions, or UI.

PR #38 is an independent web-only child of #17. It presents strictly bounded current memberships and pending invitations and offers one project-wide, authority-refreshed, idempotent revocation operation. Payloads and snapshots are strict immutable plain data; epoch/revision rollback and same-epoch membership mutation fail closed. It creates or redeems no invitation, transports or stores no plaintext token, and starts no timer, network primitive, process, provider, or agent.

PR #40 is the web-only child of #38. It exposes a bounded, injected invitation-creation command with exact project, operator, role, permission, membership-epoch, revision, and input-scope binding. The plaintext token is published exactly once in the immediate in-memory result; it is never persisted, copied, logged, transported by this UI, reconstructed, or silently regenerated. A lost token is unrecoverable and requires revocation plus a new invitation. Changed visible inputs cannot replay a hidden prior command, and lifecycle, authority, client, project, and operator changes clear the result. JavaScript strings cannot be securely zeroed, so production callers must preserve the zero-retention boundary.

PR #42 is the web-only child of #40. It accepts an explicitly entered project ID, one-time secret, and display name through an injected redemption capability, freezes one exact command for indeterminate-result retry, and clears visible secret state immediately after submission. It reads no URL, query, hash, clipboard, history, storage, provider output, or agent output. Renderer identity is only the expected receipt identity; production adapters must derive authenticated identity server-side and must not forward renderer identity as authority. JavaScript strings cannot be securely zeroed, and the frozen retry command necessarily retains its secret while an acknowledgement remains indeterminate.

PR #43 is the web-only child of #20. It enrolls a bounded device identity through an injected client and an opaque signer whose private key is never exported to the model, renderer state, or command. The proof is bound to project, user, device, membership epoch, public key, server challenge, and one-time nonce; nonce/proof material is cleared after activation, discard, stop, or scope replacement. A lost begin nonce is deliberately unrecoverable, and retries reuse the exact frozen request object. PR #20 does not expose authenticated current-key listing/revocation authority, so #43 deliberately provides neither; production adoption still requires an OS-backed non-exportable signer, authenticated transport, and session renewal.

PR #45 is the contracts/server-only child of #20. Its request accepts only the project ID; the server derives the current user and device from the authenticated principal, serializes the read with project mutations, and returns only bounded current identity, status, key ID, and activation fields. It validates the exact current membership epoch, device binding, active key, and complete enrollment-challenge lineage before reporting `active`; dangling bindings, malformed lifetimes/digests, key substitutions, stored corruption, and stale epochs fail closed. It enumerates no unrelated devices and exposes no public/private key bytes, nonce, digest, or receipt hash. The existing self-revoke authority remains actor/device/epoch/request-bound. #45 adds no endpoint, UI, OS key custody, production transport, timer, or promise that an enrollment-required result invalidates an already authenticated session.

PR #46 is the injected web-only child of #45. It requests status with the project ID only, admits only an exact project/user/current-device/membership-epoch response, and renders only `active` or `enrollment-required` for that device. Self-revoke requires explicit destructive confirmation and freezes one actor/device/epoch-bound request; only an indeterminate result can retry that exact object. Client, scope, epoch, observer, reentrancy, malformed-data, or replacement-construction failures clear or conceal prior UI. It enumerates no other devices, exposes no key/challenge/proof/receipt material, and starts no endpoint, timer, polling, storage, process, provider, or agent capability.

PR #24 is an independent child of #21. It owns content-addressed versions, recoverable tombstones, portable path authority, compare-and-swap heads, and fenced consistent database-snapshot provenance. It does not implement blob transport/quotas or the no-follow filesystem materializer and never merges live database pages or volatile sidecars.

PR #25 is another independent child of #21. It provides resolver-only authenticated admission, membership/device rechecks, encrypted project-bound cursors, keyed audit references, and bounded replay/backpressure/cancellation. It opens no listener or socket and exposes no orchestration RPC.

PR #26 continues only the #24 file-authority path. It provides quota-bounded content-addressed blob bytes and a no-follow managed-replica materializer with recoverable tombstone moves, atomic staging/replacement, crash cleanup, filesystem identity defenses, and post-commit rollback. It still opens no network listener and leaves cross-process locking and remote non-transactional revocation linearizability as explicit future boundaries.

PR #27 is an independent sibling of #26 after #24. It provides bounded operator-authored tasks, explicit ownership and state transitions, dependency integrity, CAS revisions/fences, membership-epoch-bound agent leases, one active lease per task, an eight-agent project cap, current authority rechecks, and bounded hash-chained audit. It does not execute providers or agents and opens no network listener or orchestration RPC.

PR #28 is an independent child of #25. It provides current-authority-checked, server-clock, in-memory project presence with opaque sessions, coarse capabilities, bounded snapshot/delta replay, session-bound nonblocking subscriptions, request-bound idempotency, revocation purging, and project-isolated HMAC audit references. It starts no timer, listener, socket, RPC, file/database sync, task runner, provider, or UI.

PR #29 continues only the #27 task/agent path. It defines a managed-replica-only filesystem policy, sanitized environment, default-deny public-only network allowlists, resource/output quotas, OS-isolation attestation, current-authority rechecks, and exact termination acknowledgements. Every admission returns `launch: not-started`; it contains no executor, runner backend, listener, RPC, UI, process launch, or client integration.

PR #30 is another independent child of #25. It adds a default-off, loopback-first HTTP/WebSocket adapter for chat/context façade operations with explicit non-loopback TLS/HTTPS-origin opt-in, exact Host/Origin policy, resolver-only identity, per-frame device proof, per-source and global occupancy limits, bounded queues/rates/replay, cancellation, heartbeat, slow-consumer closure, and drain shutdown. It is not wired to the production launcher/client and exposes no orchestration RPC, files, databases, tasks, agents, providers, presence, or UI.

PR #47 is the client-runtime child of #30. Construction is inert and connection is explicit; injected HTTP/WebSocket factories use only the fixed command/socket routes, opaque bearer headers, and caller-supplied fresh proof. Canonical non-loopback origins require HTTPS/WSS, credentials never enter URLs or public errors, and strict frame/status/project correlation, finite reservations, generation-scoped callbacks, bounded late-frame tombstones, exact cancellation, and contained observers fail closed. It has no timer or automatic reconnect and exposes no files, databases, tasks, agents, providers, orchestration, local paths, listener, tunnel, launcher, or UI.

PR #48 is the audited integration of #46 and #47. It adds exactly `device-key.status` and `device-key.revoke` to the fixed authenticated command path, derives user/device/membership authority server-side, adapts the network client to the current-device panel, and forwards cancellation. Status accepts only the project ID; initial revoke requires the authenticated active current key. Exact post-revoke acknowledgement replay uses an explicit resolver-attested `retained-revocation-replay` credential that is confined to the revoke operation and the store's exact durable receipt gate. It cannot authorize a new command. A deployed resolver must still verify retained public identity material; the PR adds no resolver implementation, listener launch, enrollment, enumeration, other-device revoke, key bytes, OS custody, credential persistence, automatic reconnect, polling, timer, or background retry.

PR #49 is the audited integration of #32 and #47. Its inert controller and React wrapper adapt fixed page/append commands through a project-bound 64-checkpoint opaque-cursor bridge with exact project, requested-kind, order, lane, byte, cursor, and immutable append-ack correlation. Generation and abort guards reject stale work across connect, read, append, refresh, disconnect, and synchronous reentrancy; hostile capabilities and Proxy responses are captured into bounded owned data before decode; same-project composition replacement remounts local panel state. Passive peer closure is surfaced by explicit refresh, the next command, or another lifecycle action because no polling was added. It adds no timer, replay subscription, automatic reconnect, credential persistence, listener, private-key handling, or broader cowork route.

PR #31 continues only the #26 managed-replica path. It performs online SQLite backup into a WAL-consolidated immutable artifact and quiescence-gated atomic restore with exact membership/device-key/lease/fence/head checks, conflict-fork preservation, case-insensitive sidecar rejection, filesystem identity revalidation, integrity/schema/version/hash validation, recovery rollback, and retained-storage quotas. It does not merge database pages, expose a network endpoint, or claim restart-durable idempotency; production wiring still requires cross-process exclusion and durable request receipts.

PR #32 is an independent web-only child of #21. It adds an injected shared operator chat/authored-prompt transcript and composer with bounded cursor paging, exact-ID retry/conflict states, tombstone suppression, pointer-only context summaries, lifecycle cancellation, and accessibility coverage. A null client renders nothing; it performs no fetch, socket, RPC, timer, provider/agent launch, or live-client wiring and renders no private/provider bodies.

PR #39 is the read-only web child of #32. It renders only explicit authored-prompt records with exact render-time client/project/operator/full-roster scope binding, current `transcript.read` permission, contract-aligned byte/integer limits, immutable minimal snapshots, and a 50-per-page/eight-page/400-record cap. Scope or authority changes synchronously hide prior data; stale, throwing, and hostile-thenable transports fail safely. It has no send, replay, subscription, polling, context-ingestion, timer, network, storage, filesystem, process, provider, or agent capability.

PR #44 is the web-only presentation child of #39. It adds an explicit merged/side-by-side switch over the same single bounded snapshot, with exact current-roster attribution, per-lane operator sequence, a maximum 20-lane visible window, bounded selection, and horizontal overflow. Former operators remain merged-only rather than being assigned to a current participant. Injected-client, project, permission, roster, or scope drift clears presentation state; tombstones remain bodyless; duplicate or long Unicode names wrap and use positional accessible labels. It performs no second fetch and adds no send, replay, context ingestion, subscription, polling, timer, network, storage, filesystem, process, provider, or agent capability.

PR #41 is the web-only child of #37. It presents a strict, content-addressed, authority-bound managed-replica publication/apply plan and requires explicit approval of one frozen command. The plan binds project, device, member epoch, revision, head, base, fence, hidden plan token, and content hashes; pagination and paths are bounded, and live database files and volatile SQLite, DuckDB, and LMDB sidecars are rejected. An approval response is only a receipt, never a claim that bytes were applied. Production wiring must independently revalidate authority, token, fence, base, durable idempotency, and filesystem effects; the PR itself has no direct filesystem, network, timer, process, provider, agent, or production-adapter capability.

PR #22 is an independent five-file web child of #7. Its profile allowlist explicitly excludes credentials, provider/network security, private project paths, exact-thread Auto Nudge state, legacy minute fields, media assets, native controls, pacing, telemetry, and PR #15.

PR #35 continues only the #22 local-profile path. It adds sparse allowlist-only inspect-before-load previews for active/inactive profiles, an accessible in-app delete confirmation, and immutable cross-window conflict rechecks under the mutation lock. Preview is read-only; patch-semantic equality prevents needless writes. It adds no opaque JSON import/export and does not broaden #22's security exclusions.

PR #36 is the injected web-only child of #27. It adds bounded task/ownership/dependency/revision/fence and recorded-lease presentation with replay-safe page/command tickets, exact next-revision acknowledgements, monotonic immutable authority fields, frozen defensive state, and authoritative-refresh conflict gating. It renders no task body or sensitive data; a null client is inert, every admission remains `not started`, and no runner, timer, network primitive, or process exists.

PR #37 is the injected read-only web child of #26. It presents bounded managed-replica heads, recoverable tombstones, conflict forks, materialization evidence, hashes/audit refs, and fixed local attention codes. Payloads are strict immutable plain data; paths reuse the replica's portable Unicode/Windows-reserved/alias policy; pagination rejects cycles, duplicates, and cross-page replay. It renders no bodies/absolute paths/backend prose and has no mutation control, timer, network primitive, filesystem operation, or process.

PR #23 is an independent contracts/server child of #7. It reports only measurements available through the bounded Node runtime adapter. CPU/RAM temperatures, GPU, storage temperatures, fans, RGB, project-volume probes, RPC exposure, renderer polling, and graph UI remain deferred and must not be inferred from its unavailable values.

PR #33 is the narrow web/client-runtime child of #23. It strictly decodes, bounds, and normalizes only measured aggregate CPU and process-effective RAM; preserves measured zero; turns unavailable/invalid values into graph gaps; provides true single-flight lifecycle-safe polling through an injected client; and makes Hide unavailable metrics remove unavailable cards. It adds no production endpoint/client wiring and continues to make no temperature, GPU, disk, fan, RGB, or project-volume claim.

PR #34 is the injected web-only child of #28. It requires an authoritative snapshot before accepting deltas, clears stale people on gaps/revocation/errors, binds callbacks to the current project generation, cleans subscriptions exactly once, rejects duplicate/out-of-order/oversized rosters, and presents only current coarse presence. A null client renders nothing; it starts no timer or network primitive, persists no activity history, and is not wired into the live client.

When adopting onto a newer Cafe target instead of the pinned baseline, treat these commands as an ordering manifest, not a promise of conflict-free application. Resolve migrations, settings schemas, provider lifecycle, and security boundaries semantically; never select an entire side of a conflict wholesale.

## Omnibus #8 overlap warning

PR #8 is a draft release aggregate, not the recommended Cafe review unit. It contains Auto Nudge, Idle Thread Guard, Matrix modes, telemetry, profiles, media, camera, LM Studio, and early cowork/database-contract work in one large branch.

- Do not merge #8 and then merge #13, #14, #17, #20, #21, #24, #25, #26, #27, #28, #29, #30, #31, #32, #34, #36, #37, #38, #39, #40, #41, #42, #43, #44, #45, #46, #47, #48, or #49: cowork contracts, architecture, authorization, event admission, event persistence, database coordination, membership/invitation UI, device authority/enrollment/status/controls, authored-context/timeline/lanes, file-authority, materialization/status/approval, task authority/UI, sandbox policy, transport, presence, network adapter/client/composition, SQLite snapshot, shared-chat UI, and presence-roster surfaces overlap or share migration lineage.
- Do not merge #13/#14/#17/#20/#21/#24/#25/#26/#27/#28/#29/#30/#31/#32/#34/#36/#37/#38/#39/#40/#41/#42/#43/#44/#45/#46/#47/#48/#49 and then cherry-pick equivalent cowork commits from #8.
- Do not merge #19 and then retain #8's overlapping Auto Nudge authority, migrations, projections, or renderer coordinator changes.
- Do not infer that #8 completes the user-visible cowork suite. Its own description leaves server-authoritative database admission, engine-specific snapshot adapters, secure replica materialization, network transport, and UI as later work.
- Do not combine #33 with #8/#15's equivalent Project Resources UI changes; #33 is the narrow path after #23.
- Do not combine #35 with equivalent profile-management changes from #8; land it only after the narrow #22 foundation.
- Prefer extracting a narrow, independently gated PR from #8 for each non-cowork feature family that Cafe maintainers want.

## Validation gates

At this snapshot GitHub reported no configured checks for the newly published PRs through #50. `MERGEABLE/CLEAN` describes branch topology, not test evidence; Cafe maintainers must run the recorded local gates (or equivalent CI) on the exact adopted heads.

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
- #35: focused profiles 25/25 and Chromium 44/44, repository format/lint, full typecheck 9/9, full repository tests 9/9 with server 1,572 passed/1 skipped, sparse-patch/accessor/prototype/mutable-snapshot/inactive-preview/no-write/delete-cancel/delete-conflict/empty-library accessibility coverage;
- #36: focused task model 11/11 and Chromium 5/5, web typecheck, repository format/lint, full typecheck 9/9, full repository tests 9/9 with server 1,697 passed/1 skipped, StrictMode/replay/cursor-cycle/exact-ACK/monotonic-fence/concurrent-attempt/conflict/hostile-payload/privacy/accessibility coverage, plus controlled no-timer/no-network/no-process proof;
- #37: focused replica model 21/21 and Chromium 6/6, web typecheck, repository format/lint, full typecheck 9/9, full repository tests 9/9 with server 1,703 passed/1 skipped, strict-plain-payload/mutable-input/portable-path/alias/stable-order/cross-page-replay/evidence-consistency/privacy/read-only coverage;
- #38: focused membership/invitation model 22/22 and Chromium 5/5, repository format/lint, full typecheck 9/9, full repository tests 9/9 with server 1,644 passed/1 skipped, plain-payload/accessor/shape/interval/order/revoke-concurrency/idempotency/authority-refresh/rollback/stale-lifecycle/overflow/accessibility coverage, plus a controlled no-timer/no-network/no-process/no-create/no-redeem proof;
- #39: focused prompt-timeline model 11/11 and Chromium 8/8, repository format/lint, full typecheck 9/9, full repository tests 9/9 with server 1,670 passed/1 skipped, render-scope/permission-revoke/roster-change/cross-project/hostile-thenable/accessor/proxy/UTF-8-byte/integer/replay/bidi/privacy coverage, plus a controlled no-timer/no-network/no-storage/no-process/no-send/no-context-ingestion proof;
- #40: focused invitation-creation model 37/37 and Chromium 7/7, repository format/lint, full typecheck 9/9, full repository tests 9/9 with server 1,644 passed/1 skipped and contracts 180 passed, exact-scope/immutable-retry/input-drift/atomic-secret-publication/lost-token/authority-lifecycle/hostile-payload/accessibility coverage, plus a controlled no-timer/no-network/no-storage/no-process/no-redeem proof;
- #41: focused replica-approval model 38/38 and Chromium 9/9, exact detached repository format/lint, full typecheck 9/9, full repository tests 9/9 with server 1,703 passed/1 skipped, contracts 192 passed, shared 143 passed, and scripts 111 passed/4 skipped, cross-scope/path/sidecar/pagination/plan-token/negative-zero/concurrency/authority-drift/receipt-only coverage, plus a controlled no-filesystem/no-network/no-timer/no-process/no-provider/no-agent proof;
- #42: focused invitation-redemption model 31/31 and Chromium 9/9, repository format/lint, full typecheck 9/9, full repository tests 9/9 with server 1,644 passed/1 skipped, contracts 180 passed, shared 143 passed, and scripts 111 passed/4 skipped, reentrant-factory/observer/listener-mutation/hostile-thenable/accessor/proxy/symbol/exact-retry/scope-replacement/accessibility coverage, plus a controlled no-URL/no-clipboard/no-history/no-storage/no-network/no-timer/no-process/no-provider/no-agent proof;
- #43: focused device-enrollment model 14/14 and Chromium 6/6, repository format/lint, full typecheck 9/9, full repository tests 9/9 with server 1,661 passed/1 skipped, private-capability/method-swap/reentrant-command/lost-nonce/nested-mutation/hostile-thenable/proxy/scope-replacement/accessibility coverage, plus a positive-control proof that authenticated current-key listing/revocation APIs are absent;
- #44: focused prompt-lane model 6/6 and exact Chromium timeline/lane suite 14/14, repository format/lint, full typecheck 9/9, full repository tests 9/9, client/scope replacement, state-resurrection, final-window, hostile-input, duplicate/long-Unicode, multi-panel ID, and positional accessibility coverage, plus a controlled no-fetch/no-send/no-context-ingestion/no-subscription/no-polling/no-timer/no-network/no-storage/no-process/no-provider/no-agent proof;
- #45: focused contracts/store 26/26, repository format/lint, full typecheck 9/9, full repository tests 9/9 with server 1,669 passed/1 skipped, read-vs-revoke/read-vs-rotate, dangling-binding, malformed-challenge-lifetime/digest, key-substitution, stale-epoch self-revoke, and stored-corruption coverage, plus a controlled no-endpoint/no-UI/no-timer/no-OS-key/no-production-transport proof;
- #46: focused current-device model 13/13 and exact Chromium 10/10, repository format/lint, full typecheck 9/9, full repository tests 9/9, reentrant-command/observer-expansion/hostile-scalar/replacement-construction/identity-epoch-client-drift/late-result/exact-retry/accessibility coverage, plus a controlled no-network/no-timer/no-polling/no-storage/no-process/no-provider/no-agent proof;
- #47: focused client-runtime 19/19, repository format/lint, full typecheck 9/9, full repository tests 9/9 with server 1,692 passed/1 skipped, stale-generation/proof-reservation/reconnect/project-status-correlation/abort/disconnect/late-frame/hostile-adapter/observer coverage, plus a controlled no-timer/no-reconnect/no-storage/no-filesystem/no-process/no-database/no-task/no-provider/no-orchestration proof;
- #22: audited profile units 23/23, Settings Chromium 41/41, full web 1,387/1,387 before final audit, full repository tests, duplicate/prototype/quota/timestamp adversarial coverage, and exhaustive private-field exclusion;
- #23: audited telemetry 44/44, typecheck 9/9, full repository tests 9/9 with server 1,604 passed/1 skipped and contracts 169 passed, truthful warming/unavailable states, overflow and relational-arithmetic guards, counter-failure and topology-change coverage, and no fabricated sensor measurements;
- #18: audited Matrix/settings units 133/133, focused Chromium 46/46, full Chromium 281/281, WebGL limits/context/fallback coverage, and full repository tests;
- #19: audited authority 96/96, browser 11/11, engine 19/19, full repository tests, and controlled proof that timer/minute/countdown state cannot authorize dispatch;
- #48: audited focused device composition 50/50, typecheck 9/9, full repository tests 9/9 with server 1,705 passed/1 skipped, and explicit retained-revocation-replay confinement;
- #49: audited composition model 13/13, Chromium 2/2, typecheck 9/9, full repository tests 9/9 with server 1,692 passed/1 skipped, and controlled proof of no timer/poll/replay/automatic reconnect capability;
- #15: current-snapshot availability and simulated telemetry-outage browser regressions.

A green exit code is not enough for generated or packaged work. Verify that expected bundles/artifacts were freshly produced and contain the intended feature markers before publishing the adopted head.

## Security and scope boundaries

The narrow cowork ladder intentionally does not expose the existing server-wide orchestration RPC to remote members. #13, #20, #21, #24, #25, #26, #27, #28, #29, #31, #32, #34, #36, #37, #42, #43, and #46 open no network endpoint or listener and retain no private key. #30 is the first bounded network adapter: it remains default-off and loopback-first, and non-loopback binding requires explicit opt-in, TLS, and exact HTTPS Origin policy. #47 is only its explicit, default-disconnected chat/context client. #48 and #49 compose only the current-device and shared-chat surfaces onto that fixed path; they add no listener, production launcher wiring, automatic reconnect, polling, timer, or broader route. #26 materializes only inside its managed replica after #24 authority; it never grants remote access to an arbitrary operator workspace. #31 snapshots/restores only an already-authorized managed SQLite replica and never synchronizes live pages or sidecars. #32, #34, #36, #37, #42, #43, and #46 remain injected-only and unreachable until an adopter deliberately composes a client. #37 is read-only and exposes no filesystem mutation. #42 has no secret-ingestion channel beyond the explicit form and cannot authenticate renderer-supplied identity. #43 never receives a private key and cannot list or revoke current keys. #46 and #48 expose only the authenticated current device and require explicit self-revoke confirmation. #49 composes only operator-authored project chat and prompts. #27 grants no provider or agent execution authority. #36 displays only recorded leases and `admission: not started`; it cannot launch. #28 is ephemeral and retains no durable activity history. #29 admits policy only and launches no process. #30, #47, #48, and #49 expose no orchestration RPC, file/database sync, task/agent/provider execution, or arbitrary workspace path. Future slices must preserve project-scoped authorization, current-membership and current-device-key checks, server-clock decisions, exact idempotency, revocation handling, bounded replay, recoverable deletion, managed-replica filesystem containment, fenced task/agent claims, attested isolation, strict network admission/backpressure, and fail-closed corruption behavior.

PR #44 remains injected-only and read-only; both of its layouts are projections of #39's single bounded snapshot, not new transcript or token streams. PR #45 remains server/contracts-only and can describe or self-revoke only the authenticated actor's current device in the exact project; PR #46 presents only that same current-device authority through an injected client. Neither can enumerate other devices, accept renderer-supplied user/device identity as authority, or expose enrollment secrets or key bytes. PR #47 composes only #30's bounded chat/context routes and remains explicitly disconnected by default. PR #48 adds only authenticated current-device status/self-revoke; PR #49 adds only authenticated shared operator chat. None of #44-#49 wires a production launcher or public listener, and none can synchronize files or databases.

Database files require a separate coordination policy. Prefer an authenticated external database service; otherwise use private per-operator forks plus immutable consistent snapshots. A serialized shared head is compatibility-only and requires a server-authoritative lease, monotonically increasing fencing token, and compare-and-swap publication. Never synchronize live SQLite pages or WAL/SHM/journal sidecars, DuckDB WAL files, or LMDB lock files between operators.
