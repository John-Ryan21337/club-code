# Streaming tables and currency text

Date: 2026-10-23.

Club Code had two Markdown rendering defects in Jobsearch output.

The table renderer was defined inside a memo that depended on the current
message's link metadata. Every new text chunk changed its React component
identity. React replaced the table, reset horizontal scroll, and closed its
expanded view. Automatic table layout also changed earlier column widths as
later cells grew. A synthetic browser test measured a change over 100 pixels.

The table renderer now has a stable identity. A streaming table measures its
first readable column widths before paint and retains them through completion.
Later cells wrap or scroll inside those columns. The existing table controls,
expanded view, and independent scroll containers remain available. Tables first
opened after completion retain their normal content layout.

The second defect came from single-dollar math parsing. Two prices could act as
opening and closing math delimiters. KaTeX removed spaces and rendered ordinary
words as italic symbols. Native selection could then copy symbols on separate
lines. The affected Jobsearch messages contained three such accidental spans.

Currency markers are now escaped before Markdown parsing. The same normalization
serves rendering and Markdown copy. Genuine formulas, display math, code spans,
non-math code fences, escaped dollars, and link destinations remain supported.
Stored provider output is unchanged. No clipboard permission or setting changes
are required.

Regression tests cover table identity, horizontal scroll, the expanded dialog,
column and completed-row stability through streaming and completion, and actual
browser keyboard copy/paste of salary ranges and italic prose. Currency unit
tests also cover hourly rates, table cells, adjacent streaming prices, formulas,
and literal examples. Fixtures contain synthetic text only.

Validation on the live release checkout passed formatting, lint, typechecking,
all nine repository test tasks (4,742 passed; three existing skips), all 500
Chromium browser tests, and the desktop build. The three new browser regressions
failed before the repair and passed
afterward. Desktop and phone previews used synthetic text and showed no page
overflow. The affected Jobsearch messages were checked read-only: accidental
math spans changed from three to zero, while a formula control still parsed.

The running backend serves the verified new renderer asset
`/assets/index-CGNHMDnn.js`, SHA-256
`6cfe4cd1fa62a64686fc1ebf328b341598f682956571765e6e6420533c689a26`.
Press Ctrl+R in Club Code once to load it. The automated reload stopped because
foreground-window ownership did not validate; no key was sent. No backend or
provider process was stopped. A full application restart is unnecessary.

This focused branch is based on the table component in PR #123 at `03e14be5`.
It contains only the Markdown repair, regression tests, and related documentation.
The larger pending CLI, profile, and suggestion changes remain separate.
Publication checks for this isolated branch are recorded in its pull request.
The live checkout validation and served asset above include other pending local
changes; they are not an artifact built from this focused branch.
No remote CI or other-platform result is claimed here.
