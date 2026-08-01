# Current-device key network composition

The collaboration command protocol exposes exactly two current-device operations:

- `device-key.status` accepts only `{ sharedProjectId }`.
- `device-key.revoke` accepts the existing bounded revoke command containing `commandId`,
  `sharedProjectId`, and `deviceKeyId`.

Both use the fixed authenticated `POST /api/collaboration/v1/command` path. The browser supplies
opaque bearer evidence and a per-frame device proof; it never supplies a principal, user,
device, membership epoch, permission, or role claim. The server-owned principal resolver validates
that authentication before the facade calls `CollaborationDeviceKeyStore`.

Status output is admitted only when its project, user, device, membership epoch, and active key
match the resolver-issued identity. Because this network operation is authenticated by an active
current key, the composed network client admits only the matching `active` status. Other clients
may still use the panel's existing `enrollment-required` state through a separately authorized
enrollment boundary.

Self-revoke additionally requires the requested key ID to equal the resolver-issued current key.
The device store remains the durable authority for membership, current-key state, and command
receipts. The facade permits the exact command receipt replay after revocation without requiring
the just-revoked key to remain active; a different command against a revoked key is rejected by the
store. A deployed resolver must therefore be able to verify the original credential against retained
public identity material long enough to reach that exact receipt; this verification does not grant
authority for a new command. Responses must be `revoked` or `already-applied`, contain the exact
resolved scope and key, and include a revocation timestamp.

`coworkCurrentDeviceKeyClientFromNetwork` is the narrow web composition. It captures only the
network client's two own callable device methods, freezes the adapter, forwards status without
adding selectors, and preserves the same revoke request object for the panel's explicit retry.

This slice does not add device enumeration, other-device revocation, enrollment, key material,
operating-system custody, credential persistence, a listener launcher, automatic reconnect,
polling, timers, background retry, or client restart behavior.
