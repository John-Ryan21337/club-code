# Amalgamating Schnozzle

“Send it via the Amalgamating Schnozzle” — a peculiar, indispensable attachment connecting otherwise separate contraptions.

This is an optional shared project room for people who use different AI coding tools. A teammate can use the room without a GitHub account. The room keeps ideas, notes, tasks, proposals, handoffs, reviews, and decisions. It does not grant access to a coding backend or repository.

## Implemented transport and trust

One Node.js process serves the browser app and a durable SQLite relay. There are no relay runtime npm dependencies. All clients make outbound HTTP requests over TLS. Active clients poll every two seconds; disconnect retries use exponential backoff with jitter, capped near one minute. This release uses a relay, not direct WebRTC peer connections. It is not end-to-end encrypted: the relay operator can read shared content. Use a server you trust.

The app stores a non-exportable P-256 device key in IndexedDB. Every authenticated request has a signed relay audience, timestamp, nonce, actor, and operation. Keys do not expire merely because a user was offline. The approver can revoke a device. Browser data deletion or an origin change loses access to that device key; enroll a replacement device, then revoke the old one. Do not clear browser data to troubleshoot a disconnect before exporting important drafts.

An invitation contains the relay origin, project ID, a random 256-bit one-use credential, and a 24-hour expiry. Send the block and relay address privately. It is a bearer credential until used. The relay stores its hash. Enrollment retries with the same credential and same device public key recover a lost response. Another public key cannot reuse it. Invitations do not grant GitHub access. Enrollment is limited to 30 active devices per project. This initial relay hosts one project; use a separate instance for another project's access boundary.

## Run locally

Use Node.js 24.18.0 or a later supported Node 24 patch with `node:sqlite` support. The repository's current Node runtime was used for local verification. No package install is required to run the relay.

```sh
node --env-file=scripts/schnozzle/local.env.example scripts/schnozzle/server.mjs --init
node --env-file=scripts/schnozzle/local.env.example scripts/schnozzle/server.mjs
```

Open `http://127.0.0.1:8787`. Read `schnozzle-data/setup-code.txt` locally, select **Create the first project**, enter your name, and paste the code. The setup code expires after one hour. Delete that file after setup. The first device is the project approver. HTTP is allowed only for loopback development. Do not publish this development listener through a public HTTP proxy.

The approver creates an explorer invitation and an auditor invitation. Each teammate opens the same relay origin and pastes their invitation. Members do not install a daemon, enter a provider token, or configure an inbound port. The approver is a trusted membership administrator: they can issue privileged invitations and another approver can revoke their device. The UI asks for confirmation before granting a privileged role. The system separates device identities; it cannot prove that different devices belong to different humans. Verify invitation recipients outside the app.

## Use with Club Code or Cafe Code

Open **Settings → Connections → Amalgamating Schnozzle**. Enable the option, save your HTTPS relay address, and select **Open Schnozzle**. The feature defaults to off. The native sidebar shortcut opens the room in the system browser through the existing safe external-link bridge. Disabling the option removes that shortcut. Close an already open browser room to stop that room's polling.

The room uses its own browser origin and device key. It does not embed remote JavaScript in the privileged desktop renderer. Copy selected, reviewed text from a conversation into your lane. Use **Copy context** or **Export shared context** to bring chosen material back into your AI conversation. Exports label their source, version, and untrusted-reference status. Nothing automatically prompts an AI or starts another turn.

This native integration is deliberately a small optional connector. Automatic transcript adapters, context selection inside a chat message, direct peer transport, and remote agent control are not implemented.

## Work without collisions

- Each author edits their own cards. Another member can **Explore separately** to create an independent card.
- Updates use the exact base revision. A stale update remains in the sender's outbox for comparison; it never overwrites the winner.
- The client saves drafts and pending operations in IndexedDB. It writes the event cursor and received view together. The server retains operation receipts, so an acknowledged-but-lost response cannot duplicate a write.
- The browser service worker caches only application files. API responses, enrollment codes, and signed requests are never cached by it. The room can reload offline after its first successful load.
- Only one tab per origin owns the local room at a time. A second tab reports that the room is already open.
- An auditor reviews a proposal's current revision and SHA-256 digest. A different approver can then approve that same version. The author cannot review or approve their own proposal. Editing creates a new revision with no inherited review or approval.
- Support votes help useful ideas rise in the list. Votes are advisory. A project decision does not merge code or authorize production changes.
- Reviews and approvals require a live request and an explicit UI confirmation. They are device-authenticated decisions, not hardware-backed proof of a human gesture. Do not use them as the sole authorization for a privileged automated action.
- The activity view uses each reader's local time zone and shows recent changes since their last visit. There are no push notifications or automatic AI responses.

## Raspberry Pi deployment

Use 64-bit Raspberry Pi OS Lite or a maintained Debian installation. The Pi is a suggested target; ARM64 execution, resource limits, reboot recovery, power-loss recovery, and router isolation must be verified on the actual device before public deployment. A dedicated SSD is preferable for database durability; an SD card also needs reliable power and backups.

Place the Pi on an isolated VLAN or physical firewall interface. Enforce **deny relay network → private LAN** at the router, for IPv4 and IPv6. Permit only the management path you choose. A consumer router's “DMZ host” checkbox is not proof of isolation. Do not mount private NAS shares, copy repository credentials, or attach the Pi to home Wi-Fi as a second network path.

Point a subdomain to your public address. Forward TCP 443 only to the Pi's HTTPS proxy. Check whether the ISP uses carrier-grade NAT before configuring forwarding. Use Caddy's TLS-ALPN challenge on 443 or configure DNS validation; HTTP validation would also require 80. A trusted certificate covering a public IP can work, but the certificate and renewal configuration differ. Changing the origin later creates a new browser storage/key boundary.

The `deploy` directory contains templates, not an executed deployment:

1. Install a supported Node 24 runtime and Caddy from verified upstream packages. Pin the selected versions in your deployment record.
2. Create a system account `schnozzle` with no interactive shell. Copy this directory to `/opt/schnozzle`, owned by root and not writable by the service account.
3. Create `/etc/schnozzle/relay.env` from the example. Set the actual HTTPS origin. Set ownership to root, group to `schnozzle`, and mode to `0640`.
4. Create `/var/lib/schnozzle`, owned by `schnozzle`, mode `0700`. As that account, run `server.mjs --init` with the environment file's values. Read the setup file only over your authenticated management connection.
5. Install the systemd unit, inspect it with `systemd-analyze verify`, and start it. Check that Node listens only on `127.0.0.1:8787`. Use the actual Node executable path if it differs from `/usr/bin/node`.
6. Configure Caddy using the actual hostname. Validate its configuration before enabling it. Do not enable request-body or authorization logging. The example has no access log. Keep the upstream Host header intact and overwrite `X-Schnozzle-Client-IP` with the real direct client address. The relay accepts this header only from loopback, requires it for HTTPS deployment, and uses it for per-client enrollment budgets. Do not copy an untrusted incoming header or X-Forwarded-For chain. A tunnel or another proxy needs its own verified client-address configuration.
7. Confirm the systemd IP restrictions are active on your kernel. The relay needs loopback access only. Those host restrictions are defense in depth; the router must independently block access to the private LAN.
8. Verify the public certificate, join two test devices, disconnect/reconnect a device, restart the service, revoke a device, and confirm the revoked device can no longer sync. Then verify that the relay VLAN cannot reach private LAN destinations.

The unit uses an unprivileged account, a private state directory, an immutable application directory, no capabilities, a 128 MiB JavaScript heap ceiling, a 256 MiB process memory limit, and a CPU quota. These are deployment limits, not measured Pi capacity. SQLite uses WAL and full synchronous commits. Its maximum main database size is approximately 1 GiB. Non-revocation writes stop at 512 MiB of allocated live pages, and each device has a conservative 10 MiB cumulative operation budget that includes history overhead. These limits reserve space for revocation and sync. Allow additional space for WAL, backups, and the OS. Monitor disk usage. A physically full disk still needs administrator intervention.

## Backup and recovery

Back up the SQLite database with SQLite's online backup API, or stop the relay and copy the database and any remaining WAL files together. Never copy only a live main database file. Store backups outside the Pi and restrict their access: they contain shared content and public device identities. Test restoration on an isolated instance. A restored snapshot can restore old revocation state; reconcile device revocations and cancel old invitations before exposing a restored instance.

If the only approver loses their device, the server administrator can run `node server.mjs --recover-approver` as the service account with the same origin and data settings. This revokes every former approver device, cancels pending invitations, records a recovery event, and writes a one-hour invitation to `recovery-invitation.txt` in the private data directory. Deliver it privately to the intended approver and delete the file after use. Server administrator access already permits control of the whole project database.

Reconnection is not disaster recovery. Losing the only database loses shared server history. Losing browser storage loses that device's private key and unsent drafts. Use the room's JSON export for a human-readable copy of shared cards; it is not a credential backup or complete server restore format.

## Verification

Each relay process starts a new history epoch. After a restart or backup restore, clients rebuild the shared view while retaining drafts and the outbox. Unchanged polls do not rewrite the cached view.

Administrative recovery requires explicit `SCHNOZZLE_ORIGIN` and `SCHNOZZLE_DATA`. The database retains its configured origin and refuses a different one. A revoked browser can select **Join with a new invitation** without clearing its private key or draft. Old outbox entries are held for explicit review.

For long-term use, the server administrator can reset an exhausted device budget with `node server.mjs --reset-usage FULL_DEVICE_ID`, using the same explicit environment settings and service account. Find the full device ID in the shared JSON export. This retains history and records a budget-reset event. It does not bypass the project's reserved-space threshold; export/archive and start a new instance when the project reaches 512 MiB of live database pages.

```sh
node --test scripts/schnozzle/relay.node-test.mjs
node --test scripts/schnozzle/browser-check.mjs
```

The first command uses only Node. The browser test uses the repository's pinned Playwright dependency and installed Chromium. It checks three independent browser identities, offline draft reload, queued delivery, auditor/approver flow, and duplicate-tab protection. Repository format, lint, typecheck, tests, and desktop-build gates remain required for the native connector.

## Scope still open

This is an initial working slice of the broader collaboration plan, not a complete replacement for Notion and Linear. Direct P2P/WebRTC, end-to-end group encryption and key rotation, passkey-confirmed approvals, automatic harness adapters, full history import, per-artifact audiences, rich task dependencies, leases/worktree management, quiet-hour digests, and production GitHub integration still require implementation. No code merge or deployment endpoint exists in this release.

Origin changes require exporting shared cards and setting up a new relay database with fresh invitations. In-place origin migration is not implemented. Keep the original instance private while moving data.
