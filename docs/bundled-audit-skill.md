# Bundled audit-and-repair skill

Cafe Code ships one reviewer skill, `audit-and-repair`, and installs it into the provider
configuration homes that Cafe already manages for each enabled Codex or Claude instance. The skill
tells a provider how to run an audit-and-fix pass: keep diagnosis and repair in one context, repair
every in-scope defect, and verify the result.

Source: `apps/server/src/provider/BundledAuditAndRepairSkill.ts`.

## Installation scope

The installer writes exactly one directory per provider home:

```
<provider home>/skills/audit-and-repair/
├── SKILL.md
├── agents/openai.yaml
└── .cafe-code-managed.json   (owner marker)
```

| Provider | Home used                                                                 | Resolved by                                               |
| -------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| Claude   | `CLAUDE_CONFIG_DIR` of the instance, by default `<instance HOME>/.claude` | `resolveClaudeConfigDirectory` in `Drivers/ClaudeHome.ts` |
| Codex    | the instance's shared `CODEX_HOME` (`sharedHomePath`)                     | `resolveCodexHomeLayout` in `Drivers/CodexHomeLayout.ts`  |

Explicit scope limits:

- The installer writes inside the provider home the driver passes to it. That configured path can
  be the user's ordinary Claude or Codex configuration directory. Tests use temporary homes only.
- A Codex auth overlay keeps one copy in the shared home. `skills` is a shared entry, so the shadow
  home reaches the same files through its link and holds no second copy.
- Each configured provider home gets its own copy. Two instances with different homes do not share
  one installation.
- A disabled instance installs nothing.
- Cafe does not choose an additional machine-wide installation location.

## Ownership rules

Cafe writes an owner marker, `.cafe-code-managed.json`, that records the SHA-256 digest of every
file Cafe wrote. The installer changes the directory only while that marker is valid **and** every
file still matches its digest **and** no extra file was added.

The call returns one result:

| Result                 | Meaning                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `installed`            | The directory did not exist and Cafe created it.                              |
| `updated`              | Cafe owned an unmodified older copy and replaced it with the current content. |
| `unchanged`            | Cafe owns the directory and every file already matches this build.            |
| `preserved-user-owned` | The destination is foreign or edited; its content is preserved.               |

`preserved-user-owned` covers every foreign destination:

- an unmarked directory the user created;
- a directory managed by another tool under its own marker, for example a Club Code-managed
  `audit-and-repair` skill;
- a Cafe-marked directory whose files the user edited;
- a Cafe-marked directory with an extra user file beside the managed files;
- a corrupt or unreadable marker;
- a symbolic link or Windows junction at `skills`, at `skills/audit-and-repair`, or at the
  `agents` subdirectory.

Cafe does not adopt foreign content. Unrelated skills in the same `skills` directory are left
untouched. An update rechecks the moved backup before promotion and deletion. If it finds a
concurrent edit, it restores the old directory when possible. If another writer occupies the
destination, it retains the backup and logs its location instead of deleting that content.

## Safety properties

- **Atomic swap.** The content is built in an owned temporary sibling directory,
  `.audit-and-repair.cafe-code-<uuid>`, and moved into place with `rename`. A provider never reads a
  half-written file. Updates have a brief gap between the old and new directory. A crash in that
  gap can leave the old copy in the named backup; a later install can restore the bundled skill.
- **Bounded cleanup.** The installer removes only the temporary and backup siblings that the same
  call created. It never scans or deletes other entries in `skills`. A blocked cleanup is ignored so
  it cannot turn a completed install into a reported failure.
- **Link checks.** Existing links at `skills`, the skill directory, and its `agents` child are
  treated as foreign. The caller must provide a trusted configuration home. These portable
  filesystem checks are not a security boundary against a hostile local process that changes
  ancestor directories or open files between operations.
- **Concurrency.** Two Cafe instances, or two windows of one instance, can install at the same time.
  Each attempt re-reads the destination and retries the swap at most three times, so a losing racer
  reports `unchanged` instead of overwriting the winner. Files are written with the `wx` flag, so no
  write can clobber an unexpected entry.
- **Permissions.** Directories are created with mode `0700` and files with mode `0600` where POSIX
  permissions apply.
- **Failure isolation.** A failure never blocks provider startup or a turn. The driver logs a
  warning and continues; the provider works without the skill.

## When the install runs

- **Claude** — once per enabled instance, while the driver creates it, before the adapter starts.
  Log events: `claude.skill.auditAndRepair`, `claude.skill.auditAndRepairFailed`.
- **Codex** — once while the driver creates an enabled instance, before the shadow home is
  materialized, and again in the runtime home preparation that runs before a session start or a
  request. The repeat keeps a long-lived instance current after a Cafe update. Log events:
  `codex.skill.auditAndRepair` (debug when the result is `unchanged`),
  `codex.skill.auditAndRepairFailed`.

## Removing the skill

Delete `<provider home>/skills/audit-and-repair`. Cafe reinstalls it the next time the instance
starts. To keep a local version instead, edit any managed file or add a file to the directory: Cafe
then reports `preserved-user-owned` and stops changing it.

## Tests

- `apps/server/src/provider/BundledAuditAndRepairSkill.test.ts` — install, update, idempotence,
  marker contents, user-owned and other-tool preservation, extra-file preservation, link refusal,
  corrupt marker, and concurrent install and update races.
- `apps/server/src/provider/BundledAuditAndRepairSkillHomeRouting.test.ts` — routing through the
  real Claude and Codex home resolvers, including the `CLAUDE_CONFIG_DIR` override, the Codex auth
  overlay link, and preservation of user skills in the same home.

Both suites use fresh temporary directories only. They start no provider process, use no
credentials, and touch no real home.
