# Release storage policy

Club Code releases own their application files inside the release directory. A source release must be a standalone checkout. It must not depend on a sibling checkout or external Git metadata.

Application state belongs in `.club-runtime` inside that directory. This includes the database, attachments, settings, application logs, caches, temporary files, managed provider runtimes, and private provider shadow files. Launch and restart helpers must apply this policy before they write files. External application-path overrides and links that escape the release directory must fail clearly. Never recreate a deleted project directory to restore a drive reading.

State backups belong in `backups` at the release root. Keep restore points for the latest three local calendar days of use. Gaps between uses do not expire them. Multiple launches on one day share that day's restore point. Create a backup at startup and refresh today's point once per hour while Club Code runs. Publish and verify the replacement before removing an older point.

Compress backup files to limit storage use. Three retained points can still require about three compressed copies of the included state. A new backup temporarily needs space for a fourth copy. If copying or verification fails, preserve the previous restore points. Personal files in `backups` remain untouched.

Backups include the thread database, settings, profiles, attachments, imported media, secrets, and durable browser storage. Exclude project files, managed worktrees, application binaries, caches, logs, temporary files, and process markers. External provider-owned sessions and tools remain separate. Never follow their links into a backup.

SQLite uses its online backup API. Other state files are copied while the application runs. This does not provide one atomic transaction across the database and browser storage. Unsaved in-memory work is outside the backup. These restore points reduce recovery work after state damage; a copy on the same drive does not protect against drive loss.

## Backup and recovery commands

From the release directory, create a current restore point with `node scripts/backup-state.mjs backup`. Verify a restore point with `node scripts/backup-state.mjs verify <snapshot-directory-name>`.

Use `node scripts/backup-state.mjs restore <snapshot-directory-name>` to verify and extract a restore point into a new directory under `.club-runtime/recovery`. This command does not overwrite active state. Inspect the recovered files before using them.

To activate recovered state, first stop Club Code and its provider daemon. Preserve the current `userdata` and `codex-homes` directories inside the release. If present, move the extracted `__club-private/codex-homes` directory to `.club-runtime/codex-homes`. Remove the now-empty `__club-private` container from the extracted state. Replace `userdata` with the remaining recovered state, then launch Club Code and check the threads and settings. Do not replace a database while the application is running. Keep the preserved state until recovery is confirmed.

Automatic backups require a validated release location. Ordinary server launches without one keep their existing startup behavior and do not schedule backups. An invalid backup override disables backups with a warning. A redirected backup directory must fail before cleanup or backup writes.

Managed development lanes belong in `.club-runtime/worktrees`. Reject requested worktree paths outside this directory, including paths that escape through a link. If thread startup fails after creating a lane, remove the lane only when Git confirms it is clean. Preserve a dirty lane and report the cleanup failure so uncommitted source is never discarded.

An interrupted caller does not prove that a queued turn was rejected. Preserve its thread and worktree. When deleting a thread, preserve its worktree if another thread refers to the same directory, including through a filesystem alias, or if a remaining reference cannot be checked.

User-selected projects and independently installed provider tools retain their own locations. Provider-owned credentials, sessions, skills, and plugins remain provider-owned. Shared provider links do not transfer ownership to Club Code. The application does not move or delete these files.

## Existing installations

The current process keeps its existing data location until it exits. Do not move a live database or stop the application without operator authorization.

After Club Code and its provider daemon have stopped, run this command from the release directory:

```powershell
node scripts/migrate-release-state.mjs
```

Use `--source <legacy-home>` for an existing nondefault location. The tool preserves the source. It checks for running processes, copies into local staging, verifies file hashes, and publishes the database last. An incomplete migration blocks startup. Existing application data and worktrees are never overwritten. Conflicting legacy logs and caches are archived locally.

Known shared Codex links are recorded and omitted from the copy. The provider recreates those links. An internal installed-CLI alias is redirected to the copied CLI. Unknown links stop migration.

The release directory must be writable. Packaged installation and update tests must verify data preservation before distributing this policy. A macOS application needs a dedicated writable release directory; the shared Applications directory is not an application data directory.

## Disk readings

The resource monitor first measures the selected project's actual volume. On Windows, a missing local project directory can fall back to its drive root. UNC paths, device paths, relative paths, permission errors, and I/O errors do not trigger this fallback. The existing process deadline and sanitized errors apply to both reads.
