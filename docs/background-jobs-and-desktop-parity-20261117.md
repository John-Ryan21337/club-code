# Discounted background work and desktop parity

Recorded on 2026-11-17 (America/Los_Angeles). Status: accepted priorities,
source-inspected design, implementation pending. This document does not certify
feature parity or announce a shipped background execution mode.

## Intent and evidence boundary

The operator requested discounted two-hour/eight-hour background completion as a
priority and asked for Club Code to reach parity with the native Codex and Claude
applications. These requirements supplement the current CLI compatibility work.
They do not replace it or authorize removal of accepted functionality.

This record covers the current conversation's submitted request, the supplied
AGENTS.md instructions, selected repository source, and current official product
documentation. Original message IDs and submission timestamps were not exposed;
the date above is the recording date. No other project histories or attachments
were enumerated. Source inspection used the uncommitted release checkout based on
`fe850690a072f1f04d8048bd12cf052c6ad1d2f1`, including the current provider update.
The comparison is not a hands-on benchmark of the competing applications.

Preserve accepted functionality, user data, settings, defaults, and the approved
visual design. A broad parity request does not authorize removing features or
redesigning unrelated surfaces. The existing chat-centered workflow, themes,
effects, read-only observatories, and deliberate absence of an editor/terminal
drawer remain the baseline. New task controls should fit that workflow. Any
later repair must distinguish a reproducible defect from a reviewer preference.
No visual changes are made by this document; no new visual baseline was captured.

## Accepted requirements

| ID      | Status and outcome                                                                                          | Acceptance / falsification check                                                                                                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BG-01   | Active, highest new feature priority: support the Responses API discounted two-hour and eight-hour windows. | A user can configure API access, explicitly enable spending, submit a supported job, see its state, cancel it, and retrieve its result after restarting Club. A lost submission acknowledgement must not cause a second paid submission. |
| BG-02   | Active interpretation of BG-01: communicate billing and timing accurately.                                  | UI distinguishes the initial-response target from whole-task completion, model-token discounts from tool charges, and API access from CLI subscription access. Unsupported model/window combinations cannot be submitted.                |
| PAR-01  | Active: reach comparable outcomes to native Codex and Claude desktop workflows.                             | Use the workflow matrix below and run comparable completion, approval, restart, and recovery scenarios. A capability exposed only by an underlying CLI is not automatically a verified Club workflow.                                    |
| KEEP-01 | Active regression guard: preserve compatible prior requirements.                                            | Existing provider identity, paid-usage defaults, safety blocks, exact-thread Stop/steer behavior, data recovery, browser boundaries, appearance, and macOS/Linux behavior remain intact.                                                 |

BG-03 is active: the operator subsequently requested use of a reported $200 API
credit offer. Provide setup for the credited API organization's project and a
supported Responses execution path; do not assume CLI authentication qualifies.
Acceptance requires a configured project, a bounded authorized request, and
provider billing evidence that the intended grant covered it. The reported offer
is not a verified balance, activation, expiry date, or authorization for cash
top-ups. Keep credentials server-side and do not request keys in conversation.

BG-04 is active: the operator answered **both equally** for coding and
research/document work. This supersedes the earlier coding-first proposal. Both
workflows are equal-priority release outcomes: a coding job must produce a
reviewable change with validation, while a research/document job must produce a
retrievable deliverable with appropriate source evidence. Shared transport-only
checks do not prove either end-to-end workflow.

BG-03 and BG-04 are later submitted additions in this conversation; exact message
IDs and submission timestamps were not exposed. Earlier compatible scope remains.

## Verified API boundary

The public beta supports GPT-6.2 Astra/Sol, GPT-6.1 Terra, and GPT-6 Luna. Two-hour
and eight-hour requests discount model token rates by 30% and 40%, respectively.
The target starts at acceptance and applies to the initial response, not an entire
tool workflow. Eligible follow-ups retain their discount and can receive higher
queue priority when project, model, window, and continuation ID match.
[Background guide](https://developers.openai.com/api/docs/guides/background).

```json
{
  "model": "gpt-6.2-astra",
  "input": "User-approved task input",
  "background": true,
  "stream": false,
  "service_tier": "default",
  "background_options": {
    "completion_window": "2h",
    "continuation_id": "unique-opaque-job-id"
  }
}
```

Use the returned response ID for polling and cancellation. Save complete output
before provider retention expires. A continuation ID is not conversation history
or a submission idempotency key. Accepted capacity retries belong to the API;
Club must not resubmit merely because a response remains queued.
[Create reference](https://developers.openai.com/api/reference/resources/responses/methods/create),
[cancel reference](https://developers.openai.com/api/reference/resources/responses/methods/cancel).

API project access and metering are separate from signed-in Codex usage. Eligible
subscribers can activate API credits, so additional cash charges are account
dependent; no eligibility was checked here.
[API credits](https://developers.openai.com/api/docs/guides/chatgpt-api-credits).
The benefit must be claimed against an owned API organization and used through
that organization's project. The published Pro $200 allowance is $200 per month;
the initial grant can be prorated and unused credits expire. Responses usage is
eligible; Codex API-key usage is excluded. Free credits are consumed first, but
existing purchased credits can be consumed afterward. Consequently, Club must not
claim a guaranteed credit-only spending boundary from its own usage estimate.
Provide grant/billing links, distinguish estimates from provider balances, and
pause on exhaustion. No automatic purchase or recharge is authorized by BG-03.
Background storage has its own retention behavior; no indefinite retrieval or
zero-retention promise is made.
[Data controls](https://developers.openai.com/api/docs/guides/your-data).

## Delivery order and implementation boundary

The following sequence is an engineering proposal implementing the priorities,
not a claim that these components already exist.

1. **Discounted jobs and their durable lifecycle.** Add a distinct OpenAI API
   execution path. Existing `textGeneration/CodexTextGeneration.ts` invokes the
   CLI; adding a model-picker option cannot implement this API contract. Reuse
   server-owned secret storage and SQLite migration infrastructure. Keep API
   credentials out of renderer state, profiles, logs, and exports. API spending
   stays disabled until explicitly enabled; never reuse CLI OAuth credentials.
2. **Complete coding and research/document jobs equally.** Add the tool continuation loop, isolated workspace
   binding, normal approvals, and result review to that lifecycle. A tool-free
   review/document milestone can prove the transport, but does not satisfy both
   outcomes. Include retrievable documents, source evidence for research, and
   reviewable tested code changes in the release checks. Prefer existing checked tool boundaries over another general
   shell executor. Model completion with a function call is not task completion.
3. **Schedules and an attention inbox.** Add explicit one-off/recurring schedules
   and a shared view for queued jobs, pending approvals, results, and failures.
   Reuse notifications. Keep scheduling independent from Auto Nudge, whose
   completion-triggered authorization must not become a timer authorization.
4. **Remote and hosted continuity.** Extend the reachable-server workflow with
   an explicit execution host model. Local tools require the host online even
   when OpenAI continues inference remotely. Computer-off coding requires an
   always-on executor or a supported hosted environment, not a hidden promise
   attached to background inference.
5. **Artifact and desktop workflows.** Improve generated-file review and scoped
   integration discovery. Evaluate whole-desktop control separately from Club's
   embedded browser. Preserve existing permission and operating-system boundaries.

Suggested job states: prepared, submitting, acceptance unknown, queued, running,
awaiting approval, continuing, completed, incomplete, failed, cancelling, and
cancelled. Persist the immutable submission, provider/project binding, response
IDs, complete continuation history, tool-call receipts, result references, and
usage. Keep raw task content in private application state rather than logs.

On an ambiguous POST failure, retain acceptance-unknown state unless a documented
idempotency or reconciliation mechanism proves a safe retry. On restart, retrieve
known response IDs; never restart accepted work by default. A local side effect
needs a durable receipt and effect reconciliation; uncertainty must pause for
review rather than invent an exactly-once guarantee. Revalidate grants before
resumed tool execution. Stop prevents subsequent local tools and requests while
provider cancellation is confirmed. Never fall back from a provider safety block,
API failure, unavailable model, or window to a different provider or paid tier.

## Current parity matrix

| Workflow                                | Native applications, official documentation                                                                                                                                                                                                          | Club source evidence and next gap                                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parallel coding and Git review          | Codex and Claude support isolated worktrees and review workflows. [Codex launch](https://openai.com/index/introducing-the-codex-app/), [Claude desktop](https://code.claude.com/docs/en/desktop)                                                     | Existing Git/worktree workflows in `apps/server/src/git/GitManager.ts`. Compare outcomes and recovery; do not rebuild the feature on the assumption it is missing.                                          |
| Scheduled work                          | Codex distinguishes local desktop schedules from hosted tasks. Claude offers local and cloud schedules. [Codex schedules](https://learn.chatgpt.com/docs/automations), [Claude schedules](https://code.claude.com/docs/en/desktop-scheduled-tasks)   | README defines Auto Nudge as completion-driven, not periodic. A durable user-task scheduler and results inbox remain priorities.                                                                            |
| Computer-off work and phone supervision | Codex Cloud and Claude cloud sessions provide hosted execution; local connected computers still need to be online. [Codex mobile](https://learn.chatgpt.com/docs/mobile), [Claude cloud](https://code.claude.com/docs/en/claude-code-on-the-web)     | Existing direct server connections are useful but not evidence of an equivalent managed cloud execution service.                                                                                            |
| Browser and desktop control             | Both offer browser workflows and supported native desktop control. Availability varies by OS, account, and permissions. [Codex computer use](https://learn.chatgpt.com/docs/computer-use), [Claude desktop](https://code.claude.com/docs/en/desktop) | Existing `EmbeddedBrowserWorkspace.tsx` and `provider/AgentBrowserBridge.ts` cover a supervised browser. Whole-desktop control is a different capability, not an automatic consequence of updating the CLI. |
| Notifications and approvals             | Native products notify users and expose review/approval flows.                                                                                                                                                                                       | Club already has `notifications/WebPushNotifications.ts` and `DesktopNotificationWatcher.tsx`. Consolidate attention around jobs instead of adding a duplicate notification stack.                          |
| Files, connectors, and knowledge work   | Work and Cowork provide broader file and connected-tool workflows. [ChatGPT Work](https://help.openai.com/en/articles/20001275), [Cowork surfaces](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile)      | Native/provider tools are available, but a coherent artifact-review and integration-management experience needs separate verification.                                                                      |
| Provider choice and local control       | These native products center their own ecosystems.                                                                                                                                                                                                   | Club already supports Codex, Claude, OpenCode, and LM Studio with common project/history controls. This remains useful; it does not prove better task quality or reliability.                               |

Claude desktop manages its own Claude Code copy. Updating Club's system CLI does
not update Anthropic's desktop application. Current Cowork documentation describes
cloud schedules; older material requiring the desktop to stay awake must not be
generalized to current cloud tasks.

## Required evidence before release

- Prove submissions and results, not just successful HTTP status codes.
- Interrupt after request acceptance, during queueing, during a tool action, and
  during result persistence. Verify no duplicate paid request or silent replay.
- Test repeated cancellation, duplicate completion delivery, expired responses,
  wrong project credentials, revoked permissions, disabled spending, and native
  safety blocks. Preserve complete tool/continuation history.
- Compare the same realistic coding job across products: create an isolated
  change, run tests, wait for an approval, reconnect, and inspect the final diff.
- For code changes, run repository format, lint, typecheck, and full tests; run
  the desktop build when provider/bootstrap/bundle boundaries change. Live API
  checks require configured API access and authorized spending. Lack of live
  access remains an explicit unverified boundary, not a simulated PASS.

## Tracking and receipt

Linear project updates are blocked by connector reauthentication. Do not create
duplicate issues when access returns; reconcile this record with the project.
The accepted decision was saved under the engineering hub:
[Background jobs and native desktop parity](https://app.notion.com/p/41c89738280e810d894ec7cd2eff5ecf).
The page creation returned success without warnings. A separate read-only review
passed the scope, preservation contract, and Club source inventory; it did not
independently repeat the official API/product research. The local document was
formatted with Oxfmt. These are document checks, not runtime verification.
No new runtime code, paid API call, restart, commit, PR, or parity certification is
part of this planning update. The separately verified CLI work is recorded in
[provider-update-20261117.md](provider-update-20261117.md).

The initial record introduced BG-01, BG-02, PAR-01, and KEEP-01. The subsequent
operator additions introduced BG-03 and BG-04; BG-04 supersedes only the earlier
coding-first proposal. Existing API and source findings remain prior evidence,
not fresh runtime tests. Future updates must preserve these IDs, incorporate
later same-scope operator decisions, and distinguish intent, inspected source,
fixture passes, and live results.
