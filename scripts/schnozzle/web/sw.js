const VERSION = "__SHELL_HASH__";
const CACHE = `schnozzle-shell-${VERSION}`;
const SHELL = ["/", "/app.mjs", "/client.mjs", "/style.css"];
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      const responses = await Promise.all(SHELL.map((path) => cache.match(path)));
      if (
        responses.some(
          (response) =>
            !response?.ok || response.headers.get("X-Schnozzle-Shell-Version") !== VERSION,
        )
      )
        throw new Error("Application changed during installation. Retry on the next visit.");
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("schnozzle-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.search ||
    !SHELL.includes(url.pathname)
  )
    return;
  // Cache repair accepts only this exact release. Never mix versions after a partial update.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (!response.ok || response.headers.get("X-Schnozzle-Shell-Version") !== VERSION)
          return Response.error();
        await cache.put(event.request, response.clone());
        return response;
      } catch {
        return Response.error();
      }
    }),
  );
});
