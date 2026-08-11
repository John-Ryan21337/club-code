# the-hexagons-runtime-club-code

Portable Hexagons background exported by The Hexagons Atmosphere Lab.

This package includes the operator-approved `Club Code Default` appearance. Its background and
bundled-falling-effect activation hints are both disabled; Club Code remains responsible for the
operator-controlled enable switch and its native falling atmosphere.

Copy this folder under `apps/web/src/vendor/`, import `adapter.mjs`, and mount it below Club Code's existing WindowAtmosphere layers. Bundled falling effects default off so Club Code remains the authoritative falling simulation. Keep activation and reduced-motion decisions in Club Code settings/capability policy.

## Mount

```js
import mountBackground from "./adapter.mjs";

const background = await mountBackground({
  container: document.body,
  position: "fixed",
  zIndex: 0,
});

// Apply host-authorized changes later.
background.updateSettings({ reducedMotion: "system" });

// During host teardown:
background.destroy();
```

The exported background.hexbg.json separates presentation settings, activation hints, and host-policy hints. Treat activation, renderer forcing, focus/visibility continuation, and reduced-motion behavior as host-owned decisions.
