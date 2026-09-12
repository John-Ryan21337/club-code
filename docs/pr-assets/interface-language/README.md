# Interface language review media

- `before.png`: current Cafe dev's Appearance panel, with no language selector.
- `japanese.png`: the port's real Appearance panel after selecting Japanese.
- `bilingual.png`: the same panel after selecting English + Japanese.
- `interface-language.webm`: the language selection interaction.

Captured at 1000 × 850 with the existing settings browser-test harness and synthetic settings. The before panel comes from Cafe dev `99fbaec8`. The after panel uses the current implementation and its real local-preference hook. These files do not show a live user profile or provider request.

Some labels remain English because the inherited catalog does not cover every current Cafe label. The media shows that fallback. No temporary fixture or capture configuration is part of the implementation.
