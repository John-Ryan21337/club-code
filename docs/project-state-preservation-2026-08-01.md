# Club Code Project-State Preservation Ledger — 2026-08-01

This ledger records the safe cleanup of Club Code-generated work areas on
`M:`. It is a recovery map, not release evidence.

## Scope boundary

Cleanup was limited to confirmed Club Code/Cafe Code Git worktrees and
project-generated artifacts under `M:\Cafe-Code` and root directories matching
the verified `M:\ClubCode-*` worktree set. Personal media, Dropbox, databases,
job-search material, unrelated repositories, and every other `M:` item were
outside the candidate set and were not deleted or moved.

The running checkout `M:\ClubCode-local-release`, the current common object
store `M:\Cafe-Code\cafe-code`, the older independent common object store
`M:\ClubCode`, the independent layout checkout `M:\CafeCode`, and every lane
with pre-existing uncommitted work were retained.

## Preservation completed before cleanup

- 253 current-repository worktree heads were anchored under
  `refs/archive/worktrees/20260801/current/`.
- 10 older-repository worktree heads were anchored under
  `refs/archive/worktrees/20260801/old/`.
- The independent layout head was anchored at
  `refs/archive/worktrees/20260801/independent/cafecode-layout`.
- Four complete-history Git bundles were created and verified.
- Fifteen binary tracked-diff patches were captured. Untracked-only lanes remain
  physically present because a Git patch cannot preserve their untracked files.
- Loose diffs, Claude review output, partial root server output, operational
  shortcut/smoke artifacts, and the dirty audit checkout were moved—not
  deleted—into this dated archive.

### Verified bundles

| Bundle                                        | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `cafe-code-current-all-refs.bundle`           | `5E630E88ADC4D6522ED2CF850508C00A5F8A83CC6BFB6671F37196FE0B9068AC` |
| `club-code-old-all-refs.bundle`               | `603BFECAB34FDDF9F7EA29EC552E29EC7ACFE07D6DBF3EF659BBF56335384F63` |
| `cafecode-layout-all-refs.bundle`             | `6982614E8D972FB69C11C46CAFA4FD46412AA1F0B6A3A8FCF87D3304B40F0DE4` |
| `audit-local-build-snapshots-all-refs.bundle` | `903BE339D1E55873F29F388EBE61B5515B85FC3063809D4D75478BB52E5BC550` |

Git reported complete history for every bundle.

## Retained dirty lanes

These 29 registered worktrees contained pre-existing tracked or untracked work
and were not removed:

- `M:\Cafe-Code\cafe-code`
- `.claude/worktrees/agent-a05802b1bfe36095c`
- `.claude/worktrees/agent-a0846990686817669`
- `.claude/worktrees/agent-ac80b3b4c60688089`
- `.claude/worktrees/agent-ac99f14299ec8be99`
- `.claude/worktrees/agent-ace47bcd31ff18472`
- `.claude/worktrees/agent-adc57b0052e12c575`
- `.claude/worktrees/agent-ae2bff411d0562eea`
- `.claude/worktrees/agent-ae510873ae0320a21`
- `.claude/worktrees/agent-ae75ff5f9c0d86b58`
- `.claude/worktrees/agent-af86f364f6d651ba7`
- `.claude/worktrees/slice-06`
- `.claude/worktrees/spark-slice-26`
- `.codex/worktrees/audit-slice-23b37-launch-queue`
- `.codex/worktrees/auto-nudge-web-verify`
- `.codex/worktrees/fix-root-route-loader-retry-current-dev`
- `.codex/worktrees/slice-07e1-ambient-image-settings-contract`
- `.codex/worktrees/slice-10a1-youtube-shell-continuity-repair`
- `.codex/worktrees/slice-21b`
- `.codex/worktrees/slice-23b-production-integration`
- `.codex/worktrees/slice-23b44o-true-duplicate-event-test`
- `.codex/worktrees/slice-23b45-interrupt-cancellation-review`
- `.codex/worktrees/slice-23b46b-clean-recovery-planner-invariants`
- `.codex/worktrees/slice-26a-contracts-clean`
- `.codex/worktrees/slice-26b-host-clean`
- `.codex/worktrees/slice-26c-volume-metric-clean`
- `.codex/worktrees/slice-26d-volume-probe-clean`
- `.codex/worktrees/slice-26h-gpu-adapter`
- `M:\ClubCode-pr2-repair`

Paths beginning with `.claude` or `.codex` above are relative to
`M:\Cafe-Code\cafe-code`. The independently dirty audit checkout now lives at
`dirty-checkouts\audit-local-build-snapshots` inside the preservation archive;
it also has a verified bundle and binary tracked patch.

## Consolidated artifacts

The active `M:\Cafe-Code` container now has only:

- `cafe-code` — current source/object store plus retained dirty lanes;
- `_preserved-project-state` — this dated recovery archive.

Within this archive:

- `dirty-tracked-patches` holds tracked binary diffs;
- `dirty-checkouts` holds the moved independent dirty audit checkout;
- `lane-artifacts/claude-review` holds review manifests, prompts, logs, and PR
  drafts;
- `lane-artifacts/root-apps` holds the partial root server artifact;
- `lane-artifacts/root-codex-operational` holds shortcut backups and smoke/dry
  run artifacts;
- `lane-artifacts/loose-patches` holds `chatcomposer.diff`, `chatview.diff`, and
  `ref-test-diff.patch`.

Two empty project-generated directories were removed. Clean registered
duplicates and their deregistered filesystem shells were removed only after
their heads were anchored and bundled. No dirty lane was force-removed.

## Cleanup result

- Registered common-repository worktrees decreased from 263 across the two
  common object stores to 31: 29 dirty worktrees, the clean running release,
  and the clean older object-store root.
- The independent clean layout checkout remains at `M:\CafeCode`.
- `M:` free space increased from approximately 211.63 GiB to 427.99 GiB at the
  final verification checkpoint: about 216.36 GiB net reclaimed. An earlier
  post-cleanup observation reached 438.62 GiB; free space can vary with other
  live processes on the drive, so the final value is the conservative result.
- `M:\ClubCode-local-release` remains at
  `457be1418541bfb0ab08ae5bf9aac8a729ead23f`. It was verified with zero changes
  immediately after source restoration. It now contains only the four
  intentional documentation changes from this cleanup: two modified canon/plan
  files and two new ledger files. The existing Electron client was left
  running.

During the first Windows Git-managed removal pass, Git partially removed
tracked source files from the explicitly protected running checkout while its
built processes remained alive. The checkout was known clean before the pass;
the missing tracked files were immediately restored from its exact unchanged
HEAD. Post-repair verification found zero changes, all expected source trees,
and the running Electron process set. The client was not restarted.

## Recovery

Do not delete `_preserved-project-state/2026-08-01` until every retained dirty
lane has been reviewed and intentionally landed or rejected.

To inspect a bundle without altering an existing checkout:

```powershell
git bundle list-heads M:\Cafe-Code\_preserved-project-state\2026-08-01\cafe-code-current-all-refs.bundle
```

To create a separate recovery clone:

```powershell
git clone M:\Cafe-Code\_preserved-project-state\2026-08-01\cafe-code-current-all-refs.bundle M:\ClubCode-recovery-review
```

Apply a tracked patch only in a disposable checkout at its recorded base and
review `git status` plus the diff before committing:

```powershell
git apply --check M:\Cafe-Code\_preserved-project-state\2026-08-01\dirty-tracked-patches\<lane>.patch
git apply M:\Cafe-Code\_preserved-project-state\2026-08-01\dirty-tracked-patches\<lane>.patch
```

For untracked-only lanes, review the retained physical worktree. Do not assume
an empty patch means the lane has no novel files.
