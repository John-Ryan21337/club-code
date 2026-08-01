# Local settings profile management

Settings profiles are browser/desktop-client-local presentation presets. The
management surface supports saving, loading, updating, renaming, previewing, and
deleting the bounded profile library already provided by the renderer. It does not
create an account, contact a server, or synchronize profiles between devices.

## Safety boundary

- The exhaustive `ClientSettings` policy remains the only source of fields that a
  profile can capture or apply. Credentials, provider and network configuration,
  filesystem/project paths, native controls, telemetry polling, external-media
  activation, model pacing, and exact-thread Auto Nudge authority remain excluded.
- Profile documents stay versioned in local storage, limited to 32 profiles and
  512 KiB. Names remain normalized, bounded, unique, and unsuitable as paths.
- Persisted input is copied through own data properties and schema-decoded scalar
  fields. Unknown keys, prototype-pollution keys, accessors, nested values, invalid
  timestamps, duplicates, and unsupported document versions fail closed or are
  dropped without becoming active preferences.
- Preview computes only the sparse, allowlisted patch the selected active profile
  would apply. Fields absent from an older profile are not described as changes
  because loading leaves those current values untouched. Display values are
  whitespace-normalized and bounded; excluded fields never enter the preview.
- Rename and delete recheck the immutable profile snapshot under the existing
  cross-window mutation lock. Delete uses an accessible in-app confirmation and
  refuses to remove a profile that changed in another window after confirmation
  opened.
- Loading still applies the safe preference patch before changing the active
  marker, and rolls the theme back if the settings write fails. A local-storage
  quota failure remains visible as session-only state without destroying the last
  durable document.

There is deliberately no opaque JSON import/export, credential transfer, provider
operation, network call, timer, background task, or native side effect in this
management extension. Duplicate-profile creation is deferred until it can add
clear value without weakening the existing explicit-name and quota behavior.

## Verification

Unit coverage exercises sparse preview semantics and hostile accessors in addition
to the profile library's schema, prototype, duplicate, quota, timestamp,
immutability, and mutation-lock defenses. Browser coverage exercises preview
semantics, accessible cancel/confirm deletion, stale cross-window deletion refusal,
and successful deletion alongside the existing save/load/update/rollback tests.
