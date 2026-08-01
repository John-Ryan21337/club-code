# Club Code UI Localization Canon

Status: authoritative product and safety contract. Implementation status remains
in the project plan, source, tests, and exact release evidence; this document
does not by itself claim that a language surface has shipped.

## Supported presentation choices

Club Code exposes one persisted renderer-local UI-language preference with four
choices:

- **Follow system (`system`)** resolves to Japanese when the client system or
  browser locale is Japanese and to English otherwise.
- **English (`en`)** presents first-party interface text in English.
- **日本語 (`ja`)** presents first-party interface text in Japanese.
- **English + 日本語 (`dual`)** presents both authored strings together.

The preference affects presentation only. It is not a project setting, provider
setting, automation setting, credential, consent grant, or collaboration-room
property. A settings profile, shared project, remote participant, import, or
environment-wide patch must not overwrite another renderer's language choice.

Dual mode uses `English / 日本語` for compact controls where both strings remain
legible. Longer descriptions, warnings, help text, validation messages, and
dialog copy present English first and Japanese second on separate lines or
otherwise with an equally clear visual distinction. Responsive layouts may
stack labels but must not hide either language or make a control ambiguous.

## Required first-party coverage

The selected mode covers first-party buttons, navigation, settings names and
choices, descriptions, help text, dialogs, warnings, status labels, empty and
error states, tooltips, accessible names, and the packaged Auto Nudge and Idle
Thread Guard templates. A newly added user-facing string is incomplete until it
has reviewed English and Japanese authored forms and applicable dual-layout
coverage.

Localization must never rewrite operator or project content. Chat transcripts,
operator-authored prompts, provider/model output, source code, terminal output,
file and directory names, URLs, model/provider identifiers, imported media
metadata, secrets, and protocol payloads remain exactly as supplied. Dynamic
values may be placed inside a localized sentence, but their content is not
translated. Japanese copy is authored and reviewed; the runtime must not send
interface text to a model or network translation service merely to render it.

English and Japanese safety statements carry the same concrete meaning. Humor,
branding voice, or the intentionally stylized Japanese README prose must not be
used inside product safety, privacy, paid-usage, alpha, no-warranty, or own-risk
warnings.

## Automation-template localization

Steady Progress, Hardcore Fanout, and Idle Thread Guard have reviewed authored
English and Japanese built-in variants. English mode selects the English
variant, Japanese mode selects the Japanese variant, and dual mode selects an
explicit bilingual authored variant rather than a machine-generated
translation. Follow-system selects the matching single-language variant after
locale resolution.

Only a prompt that exactly matches a recognized current or legacy Club Code
built-in may migrate when the UI language changes. Any operator-edited or
otherwise unrecognized prompt is custom and must be preserved byte-for-byte,
including whitespace. Language switching must not silently append a translation
to custom text. Resetting to a built-in remains a separate visible operator
action.

Dual templates are intentionally longer than either single-language template
and can consume more provider input tokens, credits, quota, and money. The
language selector and automation controls must display a direct warning before
or alongside selection of a bilingual automation template. Club Code offers no
guarantee about provider cost and no reimbursement for resulting usage.

## No automation authority from language

Changing language, resolving `system` after an OS/browser locale change,
migrating a recognized built-in, mounting or remounting localization UI, and
loading a settings profile must never:

- enable Auto Nudge or Idle Thread Guard;
- arm, re-arm, start, reset, shorten, or extend an automation cycle;
- create completion authority, idle authority, a queue item, or a dispatch;
- alter round caps, idle-hour values, Stop state, thread identity, durable
  deduplication, or manual FIFO priority; or
- retry a failed/rejected send.

Auto Nudge remains exact-thread, default off, bounded, and authorized only by a
new provider-confirmed completed response after accepted manual work drains.
Idle Thread Guard remains separate, exact-thread, default off, running-turn
silence based, activity-reset, one-shot per idle episode, and constrained to its
hard one-hour minimum. Language selection changes text presentation only.

## Persistence, fallback, and verification

- Missing or invalid preferences decode safely to `system` without modifying
  another setting.
- A missing Japanese catalog entry fails visibly to the reviewed English source
  rather than presenting an empty control or guessing a translation.
- Locale detection and language changes do not require a client restart.
- Document language and accessibility metadata reflect the effective mode;
  dual content remains navigable and understandable to screen readers.
- Tests cover all four preferences, Japanese-system resolution, compact and
  descriptive dual rendering, fallback, persistence isolation, custom-prompt
  preservation, recognized-default migration, and the absence of automation
  side effects.
- A catalog audit reports untranslated first-party UI literals. Zero-result
  claims require a known-match control, and generated/built output cannot stand
  in for a source and runtime check.

Release evidence requires focused contract/unit/browser checks plus desktop and
responsive smoke in English, Japanese, and dual modes. Until that evidence is
recorded, coverage is reported as partial or validation pending rather than
"the entire UI is translated."
