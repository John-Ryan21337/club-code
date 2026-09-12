# Provider usage review media

These screenshots render the real usage widget and its real scroll region inside a synthetic sidebar frame. The project/thread area is a labeled placeholder, not a running Cafe session. The before image has the panel disabled. The after image enables it with one synthetic account window and a second provider without a polling capability.

The video shows the panel appearing, a manual usage refresh, and focus on the resize separator. Provider snapshots and the account-refresh RPC are mocked; no account credentials or live usage are accessed. Permanent browser tests separately verify keyboard resizing, small-viewport bounds, stale advice suppression, exact-instance polling, hidden-document behavior, and unmount cleanup.

Temporary media fixtures were removed after capture.
