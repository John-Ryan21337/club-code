# Matrix hardware lighting sync

Club Code can mirror its resolved Matrix palette to compatible keyboards, case controllers, and
other RGB devices through the OpenRGB SDK. OpenRGB remains the hardware and vendor compatibility
layer; Club Code does not load vendor SDKs, scan for vendor utilities, or launch them.

## Operator setup

1. Install and start OpenRGB for the host operating system.
2. Enable OpenRGB's SDK server on its default TCP port, `6742`.
3. In Club Code, open **Settings → Appearance → Window atmosphere**.
4. Under **Keyboard & case RGB**, choose **Refresh devices**.
5. Select one or more compatible controllers, choose the brightness, then enable the sync switch.
6. Enable the falling atmosphere and select the Matrix effect. Rain and snow do not write to RGB
   hardware.

The setting is deliberately off by default. A presentation profile cannot activate the sync,
retarget devices, or change its brightness/restoration policy. Those settings require a direct
operator choice on the host.

## Runtime behavior

- The exact resolved `MatrixColorFrame` is the canonical color source. Fixed and uniform animated
  modes send their exact displayed RGB color. Per-stream modes project the same HSL basis into a
  deterministic, bounded 32-color hardware palette.
- The desktop renderer publishes at no more than 20 frames per second. A one-second heartbeat keeps
  a three-second server lease alive when the palette is frozen or unchanged.
- Only an owner Electron session connected over loopback may publish physical frames. Remote WebUI
  clients may configure the persisted opt-in and device selection, but cannot race hardware writes.
- The server connects only to `127.0.0.1:6742`. It does not discover or connect to LAN OpenRGB
  servers.
- Controller serial numbers and device paths are used only to derive stable, one-way identifiers.
  Raw identifiers never cross the server boundary.
- Club Code records the prior LED colors and active mode before its first write. It restores that
  state when sync is disabled, Matrix stops, the renderer disappears, or the server shuts down,
  unless the operator disables restoration.
- Writes are bounded to 64 palette colors at the RPC edge and 4,096 device colors in the adapter.
  Controller, payload, string, mode, zone, and segment counts are also capped before allocation.

OpenRGB documents its SDK as a versioned binary TCP protocol and assigns port 6742 as the default.
Club Code negotiates protocol version 5, the latest released packet layout currently documented;
protocol version 6 is still marked unreleased in the upstream documentation. See the official
[OpenRGB SDK documentation](https://gitlab.com/CalcProgrammer1/OpenRGB/-/raw/master/Documentation/OpenRGBSDK.md)
and [RGB controller interface](https://gitlab.com/CalcProgrammer1/OpenRGB/-/raw/master/RGBController/RGBControllerInterface.h).

## Diagnostics and recovery

The settings row reports one of these truthful states:

- **Disabled**: Club Code will not write to devices.
- **Unavailable**: OpenRGB is not listening on loopback or did not complete the bounded capability
  check.
- **Available**: compatible controllers were discovered, but no frame has been applied.
- **Active**: a Matrix frame was applied and the safety lease is live.
- **Error**: the adapter rejected or failed a frame or restoration operation.

If discovery fails, confirm that OpenRGB is running and its SDK server is enabled, then use
**Refresh devices**. If a controller is listed as unsupported, it did not advertise a direct
per-LED color mode; Club Code will not guess at a vendor-specific mode. If OpenRGB reports a device
list change or closes the connection, Club Code stops using the old device indexes and reconnects
on a later frame or explicit refresh.

## Verification

The adapter integration test runs against a real loopback TCP fixture that implements the relevant
OpenRGB packets. It verifies protocol negotiation, bounded and sanitized inventory parsing, exact
UpdateLEDs framing, brightness mapping, prior-color restoration, prior-mode restoration, and
fail-closed controller limits. Separate tests cover publisher authority, the generic write safety
controller, settings defaults/validation, exact Matrix palette projection, and the operator-facing
browser controls.

Physical LEDs are still an environment-specific acceptance test. On a host with OpenRGB and target
hardware, verify discovery, enable/disable restoration, all Matrix color modes, renderer closure,
server shutdown, and device hot-plug before calling a particular hardware model certified.
