# Provider safety findings

Codex can end a task after an asynchronous provider safety review. The native
`misalignmentPolicyViolation` error can include `misalignment.detailedExplanation`.
Club Code previously retained that finding in the provider journal but discarded it
when it created the visible error activity. Users saw only a generic runtime error.

The adapter keeps session errors generic and preserves the bounded finding only
in the thread's work log, including errors received only with `turn/completed`.
The work log labels native safety errors as
**Provider safety block** and shows the finding. A child error remains scoped to
the child task. A native safety error never becomes a transport-retry notice.
Unknown error variants keep their existing behavior. Findings are provider claims,
not instructions or proof of unauthorized activity. No continuation is inferred
from `steer` or `reviewTarget`, and no provider switch or automatic replay is added.

An independent review does not itself authorize sending private records to another
provider. Check the approved provider and inputs before an external review. Use
the smallest necessary input set. Keep raw prompts and private findings out of
repository fixtures and project-management records.

OpenAI describes CLI tasks as ending without the full findings and resume controls
available on some other surfaces. Club Code shows a finding when the native
protocol supplies one. It cannot clear an upstream block or guarantee that a later
task will pass provider monitoring. See the [official monitoring guidance](https://learn.chatgpt.com/docs/agent-approvals-security).
