# Security context and release checks

Scope: optional native launcher, browser room, enrollment, durable relay and deployment templates. Mode: design and implementation, with local security regression tests. The intended users are three collaborating humans. Internet clients, a malicious member, hostile shared text, a stolen invitation, a compromised browser, and a compromised relay are separate threat actors.

Trust boundaries:

```text
Coding tool → explicit copy/paste → browser room
Browser device key → signed outbound HTTPS → TLS proxy → loopback relay → SQLite
Relay VLAN → router-enforced denial → private LAN
```

The browser and relay can read room content. GitHub, provider accounts, production credentials, shell access and filesystem tools are outside this service. The relay never follows a shared URL, executes a command, or invokes an LLM. The native connector opens a validated HTTP-loopback or HTTPS origin using the existing external-link API. Invitations are entered only in the isolated browser room.

| Threat                       | Control                                                                                                                                                       | Evidence                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Invitation guessing/reuse    | 256-bit random secret; one-use key-bound enrollment; expiry; per-client attempt cap                                                                           | Enrollment and expiry tests                                 |
| Stolen request / wrong relay | P-256 signature over exact message bytes, audience, time and nonce; nonce replay table                                                                        | Signature negatives                                         |
| Device revocation bypass     | Current member lookup at every authenticated call; cancellation of pending invitations                                                                        | Revocation test                                             |
| Horizontal access            | Project-scoped queries and per-author edits                                                                                                                   | Cross-project and lane tests                                |
| Lost ACK / duplicate write   | Atomic write and stable operation receipt                                                                                                                     | Idempotency and restart tests                               |
| Concurrent overwrite         | Compare-and-swap base revision                                                                                                                                | Competing edit test                                         |
| Approval reused after edit   | Exact revision and digest; distinct author, auditor and approver device identities; current auditor membership                                                | Approval test                                               |
| Prompt injection             | Shared text is inert; no agent execution API; manual context adoption                                                                                         | Architecture and UI inspection                              |
| HTML injection               | Text nodes and `textContent`; no shared HTML rendering; restrictive CSP                                                                                       | Browser test and source review                              |
| CSRF / DNS rebinding         | No cookies; signed API; exact Host and Origin checks; JSON-only POST                                                                                          | HTTP tests                                                  |
| Resource exhaustion          | 48 KB request limit, bounded cursor pages, device/global budgets, connection and timeout limits, 30 members, 10,000 cards, database and service resource caps | HTTP body test; other limits need target load qualification |
| Host pivot                   | Loopback listener, restricted service, no application outbound fetching; isolated network enforced outside Pi                                                 | Configuration only; target verification pending             |

Baseline references: OWASP ASVS 5.0.0, especially authentication, authorization, browser controls, data protection and secure communication. No claim of complete ASVS verification is made, and no unverified requirement IDs are assigned. Node SQLite and cryptographic behavior use the Node 24 API. Review sources: https://github.com/OWASP/ASVS/releases/tag/v5.0.0, https://nodejs.org/docs/latest-v24.x/api/sqlite.html, https://nodejs.org/docs/latest-v24.x/api/crypto.html.

Known limitations: no end-to-end encryption, hardware human-presence proof, self-service key recovery, or automated backup rotation. Browser-origin compromise can sign as its device. Server compromise can read or falsify shared project state. A signed device request does not prove a human intended it. The trusted membership administrator can create devices in several roles; device separation does not establish distinct human identities. Privileged invitations require explicit UI confirmation and appear in the shared event history. These limits prohibit treating room approvals as production execution authority. The relay's protocol signature envelope needs independent review before an internet-facing release; it is authentication, not a custom encryption scheme.

Revocation stops future requests. It cannot erase content already downloaded by a former member. Disk and browser cache retention must match the team's data policy. The initial room gives every member access to all shared cards; do not share source material that a member is not entitled to receive.

Deployment status: no Pi, router, firewall, DNS record or public service has been configured by this change. No external dynamic scan has been run. Local tests do not verify the actual network's isolation or establish that this application is vulnerability-free.

Run administrative recovery and usage resets as the service account, with the same explicit environment file as the service. For example, use `sudo -u schnozzle /usr/bin/node --env-file=/etc/schnozzle/relay.env /opt/schnozzle/server.mjs --recover-approver`, or replace the final argument with `--reset-usage FULL_DEVICE_ID`. Do not run these commands as root: SQLite side files must remain owned by the service account. Recovery revokes former approvers; usage reset retains history. See the README for the invitation delivery and audit effects.

If browser cache storage is removed during a server upgrade, close all tabs for the relay and reopen it online. The service worker refuses to mix files from different releases. Display names are not identity proof; verify the device ID shown beside each name. No version of this initial delivery has been released with an older outbox format.
