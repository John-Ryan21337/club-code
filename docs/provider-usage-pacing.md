# Provider usage and pacing

Open **Settings → Providers → Provider usage**. Enable the sidebar panel to show account usage reported by each configured provider. The panel is off by default. It refreshes every two minutes while the document is visible; you can set one to five minutes. The refresh button uses the same bounded usage service and its existing throttle.

The panel shows usage windows, known reset times, the last observation time, and the provider's reported reset-credit balance. Unknown percentages and balances stay unknown. Old observations are marked stale. A cached value is not proof that the current account is authenticated or that a request will succeed.

Only a live provider implementation with Cafe's `refreshAccountUsage` capability can be polled. Polling does not run installation, authentication, or model-list probes and does not send a model prompt. The RPC requires an exact instance to do work; an untargeted usage refresh only returns cached snapshots. Responses from a replaced provider instance are discarded. Providers without polling support can still show dated usage facts already received from their normal event stream.

The desktop panel has a keyboard- and pointer-operated height separator. Mobile uses a smaller bounded region so the thread list remains reachable. The resize preference is local to this browser.

**Advisory model pacing** is a separate opt-in setting. It compares the provider-reported percentage with the elapsed part of the reported window, leaving the configured reserve outside the suggested pace. The reserve defaults to ten percent and can range from zero to fifty percent. Advice is unavailable when required values are missing, the device clock is outside the window, the reset is due, the observation is stale, or the provider reports an exhausted usage or spend limit.

A limit is model-specific only when its reported identity matches exactly one available model. Other limits are labeled shared/account limits. Pacing never selects a model, blocks a prompt, changes permissions, changes worker ceilings, or controls billing.

This current-Cafe port uses the existing account window and credit-balance contracts. Paid-spend metadata and reset-credit redemption are separate adoption work; the panel does not invent these values or expose a redemption action.
