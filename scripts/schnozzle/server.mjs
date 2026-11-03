import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { Store, Refusal, requireValue } from "./store.mjs";

const directory = fileURLToPath(new URL(".", import.meta.url));
export function clientSubnet(ip) {
  ip = ip.split("%")[0];
  if (isIP(ip) !== 6) return ip;
  const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const [left, right] = canonical.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const groups =
    right === undefined
      ? head
      : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  const words = groups.map((value) => Number.parseInt(value, 16));
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 65535)
    return `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
  return (
    groups
      .slice(0, 4)
      .map((value) => value.padStart(4, "0"))
      .join(":") + "::/64"
  );
}
export function validateOrigin(value) {
  const url = new URL(value);
  requireValue(
    url.origin === value && !url.username && !url.password,
    "Use an origin without a path",
  );
  requireValue(
    url.protocol === "https:" ||
      (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)),
    "Use HTTPS outside localhost",
  );
  return url.origin;
}

export function makeServer(store) {
  const assets = new Map(
    [
      ["/", ["index.html", "text/html; charset=utf-8"]],
      ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
      ["/client.mjs", ["client.mjs", "text/javascript; charset=utf-8"]],
      ["/style.css", ["style.css", "text/css; charset=utf-8"]],
      ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
    ].map(([path, [file, type]]) => [
      path,
      { body: readFileSync(join(directory, "web", file)), type },
    ]),
  );
  const version = createHash("sha256");
  for (const asset of assets.values()) version.update(asset.body);
  const shellVersion = version.digest("hex");
  assets.get("/sw.js").body = Buffer.from(
    assets.get("/sw.js").body.toString().replace("__SHELL_HASH__", shellVersion),
  );
  const buckets = new Map();
  const deviceBuckets = new Map();
  const allow = (key, limit, authenticated = false) => {
    const entries = authenticated ? deviceBuckets : buckets;
    const now = Date.now();
    if (!entries.has(key) && entries.size >= 3000) entries.delete(entries.keys().next().value);
    let entry = entries.get(key);
    if (!entry || entry.until <= now) {
      entry = { until: now + 60000, count: 0 };
      entries.set(key, entry);
    }
    requireValue(++entry.count <= limit, "Too many requests. Wait one minute.", 429);
  };
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (store.origin.startsWith("https:"))
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      requireValue(
        req.headers.host === new URL(store.origin).host,
        "Unexpected relay address",
        421,
      );
      if (req.headers.origin)
        requireValue(req.headers.origin === store.origin, "Unexpected request origin", 403);
      const path = req.url;
      if (req.method === "GET" && assets.has(path)) {
        const asset = assets.get(path);
        res.setHeader("X-Schnozzle-Shell-Version", shellVersion);
        res.writeHead(200, { "Content-Type": asset.type });
        res.end(asset.body);
        return;
      }
      if (req.method === "GET" && path === "/health") {
        send(200, { ok: true });
        return;
      }
      requireValue(
        req.method === "POST" && ["/api/enroll", "/api/request"].includes(path),
        "Route was not found",
        404,
      );
      // The local proxy must overwrite this header. Ignore forwarded-address chains.
      const proxyIP = req.headers["x-schnozzle-client-ip"];
      const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
      if (store.origin.startsWith("https:"))
        requireValue(
          loopback && typeof proxyIP === "string" && isIP(proxyIP),
          "Configure the proxy client-address header",
          503,
        );
      const clientIP =
        loopback && typeof proxyIP === "string" && isIP(proxyIP)
          ? proxyIP
          : req.socket.remoteAddress;
      const subnet = clientSubnet(clientIP);
      allow(`network:${subnet}`, 1200);
      if (path === "/api/enroll") allow(`enrollment:${subnet}`, 20);
      requireValue(
        req.headers["content-type"]?.split(";")[0] === "application/json",
        "Use application/json",
        415,
      );
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        requireValue(size <= 48000, "Request is too large", 413);
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new Refusal(400, "Invalid JSON");
      }
      requireValue(body && typeof body === "object" && !Array.isArray(body));
      if (path === "/api/enroll") {
        send(200, store.enroll(body));
        return;
      }
      const { actor, request } = store.authenticate(body, (member) =>
        allow(`device:${member.id}`, 180, true),
      );
      send(200, store.dispatch(actor, request));
    } catch (error) {
      if (!res.headersSent)
        send(error instanceof Refusal ? error.status : 500, {
          error: error instanceof Refusal ? error.message : "Relay could not complete the request",
          code: error instanceof Refusal ? error.code : "relay_error",
        });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.timeout = 20000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 100;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  if (process.argv.includes("--init") || process.env.SCHNOZZLE_DATA || process.env.STATE_DIRECTORY)
    requireValue(
      process.env.SCHNOZZLE_ORIGIN,
      "Set SCHNOZZLE_ORIGIN explicitly before initialization or configured service startup",
    );
  const resetIndex = process.argv.indexOf("--reset-usage");
  if (process.argv.includes("--recover-approver") || resetIndex >= 0)
    requireValue(
      process.env.SCHNOZZLE_ORIGIN && process.env.SCHNOZZLE_DATA,
      "Administrative commands require explicit SCHNOZZLE_ORIGIN and SCHNOZZLE_DATA",
    );
  const origin = validateOrigin(process.env.SCHNOZZLE_ORIGIN ?? "http://127.0.0.1:8787");
  const data = resolve(
    process.env.SCHNOZZLE_DATA ?? process.env.STATE_DIRECTORY ?? "./schnozzle-data",
  );
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const store = new Store(join(data, "relay.sqlite"), origin);
  if (resetIndex >= 0) {
    store.resetUsage(process.argv[resetIndex + 1]);
    store.close();
    console.log("Device usage budget reset; shared history retained.");
  } else if (process.argv.includes("--recover-approver")) {
    const path = join(data, "recovery-invitation.txt");
    writeFileSync(path, store.recoverApprover(), { mode: 0o600 });
    chmodSync(path, 0o600);
    console.log(
      "Previous approver devices revoked. Recovery invitation saved privately; expires in one hour.",
    );
    store.close();
  } else if (process.argv.includes("--init")) {
    const path = join(data, "setup-code.txt");
    writeFileSync(path, store.bootstrap(), { mode: 0o600, flag: "w" });
    chmodSync(path, 0o600);
    console.log("Setup code saved to the private data directory. It expires in one hour.");
    store.close();
  } else {
    const port = Number(process.env.SCHNOZZLE_PORT ?? 8787);
    requireValue(Number.isSafeInteger(port) && port > 0 && port <= 65535, "Invalid port");
    const server = makeServer(store);
    server.listen(port, "127.0.0.1", () =>
      console.log("Schnozzle relay is listening on loopback."),
    );
    const stop = () => {
      server.close(() => {
        store.close();
        process.exit(0);
      });
      server.closeIdleConnections();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
}
