# Deep research

Click the microscope icon in the prompt area. Choose **Use selected agent** or
**Use OpenAI API**, then submit a topic. The icon returns to off after the topic
is accepted. A rejected submission keeps the draft and research selection.

## Selected agent

The current agent receives research instructions for this task. It checks the
scope, asks up to three useful clarification questions, then uses its available
search tools to write a report with source links. It keeps the current model and
permissions. Availability and usage follow that provider's tools and account.
This does not enable the research service in the ChatGPT or Claude website.

## OpenAI API

Open **API setup and saved reports** from the same icon. Save an OpenAI API key
for this Club Code server. API usage is billed separately from a ChatGPT
subscription. The current agent's provider does not affect this workflow.

Submit a text topic to save a draft and open the scope review. Answer the three
scope questions as needed: boundaries and location, time period, and desired
result and sources. These are fixed review questions; the selected-agent
workflow asks questions tailored to the topic. Review the model and tool-call
limit, then click **Start paid API research**. Saving a draft and reviewing its
scope do not call OpenAI. Only this final action starts the paid request.

The API request uses `o4-mini-deep-research` or `o3-deep-research`, web search,
background mode, and an output limit of 16,000 tokens including reasoning.
The tool-call limit is not a price cap. Model access depends on the API project.
Only the topic and scope answers are sent, with report instructions. Attachments
and browser context are rejected with a choice to use the selected agent instead.
Chat history, project files, and other workspace data are not attached.

OpenAI runs the research in the background. The request explicitly uses
`store: true` so its response can be retrieved after the panel or app closes,
subject to the OpenAI project's retention policy. Reopen saved reports and
select the run to resume polling. Completed reports include source links and
reported API token counts. Download a report as Markdown, cancel an active run,
or delete its saved local record. Local deletion does not delete data at OpenAI.

The server keeps up to 50 local runs and permits one active API research run at
a time. Saved response IDs survive server restarts. A repeated start does not
submit another paid request. If the start response is lost, the run is marked
uncertain. Check the OpenAI dashboard before using the explicit action to close
that local record; closing an uncertain record does not cancel remote work.
If a saved response expires or API access changes, the run becomes uncertain
and retains its response ID. You can check its status again or close it locally
after checking OpenAI. An ambiguous start timeout is never treated as a definite
rejection that can be retried automatically.

## Security and verification

API research is restricted to authenticated server owners. Other owners of the
same server can use its key and read its reports. Remote environments route
requests and credentials to their own server. The key uses the existing server
secret store; it is not stored in browser persistence or returned through the
API. The store uses restricted files, not application-level encryption.

The request boundary accepts bounded JSON and fixed models, budgets, and action
types. OpenAI requests use a fixed HTTPS origin, refuse redirects, bound reads,
and report sanitized errors. The server writes a start marker before sending a
paid request and never automatically retries an uncertain start.
Reports use a separate Markdown renderer that does not fetch images, render
embedded HTML, or expose local file actions. Only HTTP and HTTPS links can be
opened. Valid citation offsets produce clickable source links.

Focused service and HTTP tests use an injected OpenAI transport and test owner
authorization, malformed inputs, key secrecy, duplicate starts, restart polling,
cancellation, citations, usage, and failure recovery. Browser tests cover the
one-shot toggle, scope review, explicit paid start, and key field cleanup. These
fixtures do not establish live model entitlement or billing access.
A fresh audit repaired report rendering, citation handling, and recovery when
responses become unavailable. The real composer tests cover both workflows,
including one-shot reset and keeping API topics out of provider chat dispatch.

API behavior follows the official [Deep Research guide](https://developers.openai.com/api/docs/guides/deep-research)
and [background mode guide](https://developers.openai.com/api/docs/guides/background).
