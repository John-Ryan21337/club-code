# World clock and weather widget

Club Code can show a transparent, movable world-clock panel in both the Electron app and an
authenticated browser/LAN session. It is disabled by default.

## Configure it

Open **Settings → Appearance → World clock & weather**.

- Enable or disable the complete widget.
- Choose **Rainbow shimmer**, **Amber nixie tubes**, **Transparent analog**, or
  **Old-school LED**.
- Select one to six cities. Each catalog entry stores an explicit IANA timezone, so the clock
  follows the browser's timezone database and daylight-saving rules.
- Optionally enable current weather.

The time display follows Club Code's shared locale/12-hour/24-hour preference. The visual
configuration is included in Settings profiles. Panel position, size, collapsed state, and weather
consent stay local to each browser or Electron renderer. Weather consent is neither synced to
other connected clients nor included in Settings profiles, so each renderer must opt in itself.

Drag the grip to move the panel, use the lower-right handle to resize it, and use the chevron to
collapse it. Both geometry handles support arrow keys; hold Shift for one-pixel adjustments. The
panel clamps itself inside narrow/mobile viewports. Clock ticks, Matrix-palette subscriptions, and
weather polling pause while the panel is collapsed or the document is hidden.

## Weather network and privacy boundary

Weather is a separate, disabled-by-default opt-in. When enabled, the renderer sends the selected
city coordinates and the device/browser's network IP directly to the official
[Open-Meteo forecast API](https://open-meteo.com/en/docs). It sends no prompt, project, provider,
account, or workspace data and uses no Club Code credential.

Open-Meteo's keyless free endpoint is limited to non-commercial use, requires attribution under
CC BY 4.0, and is rate-limited. Its terms say troubleshooting logs may include IP addresses and
requested coordinates and are deleted after 90 days. Commercial users must leave the keyless
weather option disabled unless Club Code is later configured with a suitable paid endpoint. Read
the current [Open-Meteo terms](https://open-meteo.com/en/terms) and
[pricing/API plans](https://open-meteo.com/en/pricing) before enabling it.

Implementation boundaries:

- One batched HTTPS request covers at most six selected cities.
- Fresh observations are cached for 15 minutes; identical in-flight reads are coalesced.
- Requests time out after 8 seconds and responses are capped at 64 KiB.
- Failed refreshes retain a prior observation only when visibly marked **stale**.
- With no usable observation, the panel says **Weather unavailable** and retries no faster than
  every 5 minutes.
- Conditions are the provider's WMO weather-code classification. Weather can be delayed,
  incomplete, inaccurate, or unavailable.

## Alpha notice

Club Code is alpha/testing software. It is provided without warranties or claims of reliability,
fitness for a particular purpose, or uninterrupted operation. Use it at your own risk, keep
backups of important work, and verify important results.
