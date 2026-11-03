import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { request as httpRequest } from "node:http";
import { Store } from "./store.mjs";
import { makeServer, validateOrigin, clientSubnet } from "./server.mjs";
import { reduceEvents, post, validateCardReceipt } from "./web/client.mjs";

const origin = "https://relay.example.test";
const keys = () => {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { ...pair, key: pair.publicKey.export({ format: "jwk" }) };
};
function fixture(t, path = ":memory:") {
  const store = new Store(path, origin);
  t.after(() => {
    if (store.db.isOpen) store.close();
  });
  const ownerKeys = keys();
  const owner = store.enroll({
    create: true,
    secret: store.bootstrap(),
    projectName: "Test project",
    name: "CEO",
    key: ownerKeys.key,
  });
  const actor = (member) => store.one("SELECT * FROM members WHERE id=?", member.id);
  const send = (member, body) => store.dispatch(actor(member), { id: randomUUID(), ...body });
  const invite = (role) => {
    const response = send(owner, { type: "invite", role });
    return JSON.parse(Buffer.from(response.invitation.slice(11), "base64url").toString());
  };
  const enroll = (role) => {
    const pair = keys();
    const invitation = invite(role);
    return { ...store.enroll({ secret: invitation.secret, name: role, key: pair.key }), pair };
  };
  return { store, owner, ownerKeys, send, invite, enroll, actor };
}
const card = (id = randomUUID()) => ({
  type: "card",
  card: id,
  base: 0,
  content: {
    kind: "proposal",
    state: "open",
    title: "A better order flow",
    text: "Field requirement",
    lane: "Explorer",
  },
});

test("one-use enrollment survives a lost response, but cannot enroll another key", (t) => {
  const f = fixture(t);
  const invitation = f.invite("explorer");
  const pair = keys();
  const input = { secret: invitation.secret, name: "Explorer", key: pair.key };
  const first = f.store.enroll(input);
  assert.deepEqual({ ...f.store.enroll(input) }, first);
  assert.throws(() => f.store.enroll({ ...input, key: keys().key }), /already used/);
  assert.equal(f.store.one("SELECT count(*) AS n FROM members").n, 2);
  assert.equal(
    f.store.one("SELECT count(*) AS n FROM receipts WHERE result LIKE ?", `%${invitation.secret}%`)
      .n,
    0,
  );
});
test("expired invitations cannot enroll", (t) => {
  const f = fixture(t);
  const invitation = f.invite("explorer");
  f.store.now = () => Date.now() + 90000000;
  assert.throws(
    () => f.store.enroll({ secret: invitation.secret, name: "Late", key: keys().key }),
    /expired/,
  );
});
test("signed requests bind actor, audience, timestamp and nonce", (t) => {
  const f = fixture(t);
  const envelope = (body, privateKey = f.ownerKeys.privateKey) => {
    const message = JSON.stringify(body);
    return {
      message,
      signature: sign("sha256", Buffer.from(message), {
        key: privateKey,
        dsaEncoding: "ieee-p1363",
      }).toString("base64url"),
    };
  };
  const message = {
    actor: f.owner.id,
    audience: origin,
    at: Date.now(),
    nonce: randomUUID(),
    request: { type: "sync", cursor: 0 },
  };
  const signed = envelope(message);
  assert.throws(
    () =>
      f.store.authenticate(signed, () => {
        throw new Error("Rate limit");
      }),
    /Rate limit/,
  );
  assert.equal(f.store.one("SELECT count(*) AS n FROM nonces").n, 0);
  assert.equal(f.store.authenticate(signed).actor.id, f.owner.id);
  assert.throws(() => f.store.authenticate(signed), /already used/);
  assert.throws(
    () => f.store.authenticate(envelope({ ...message, nonce: randomUUID() }, keys().privateKey)),
    /signature/,
  );
  assert.throws(
    () => f.store.authenticate(envelope({ ...message, audience: "https://other.test" })),
    /address/,
  );
  assert.throws(
    () => f.store.authenticate(envelope({ ...message, at: Date.now() - 360000 })),
    /time/,
  );
});
test("independent cards coexist; same-card concurrent edits fail without changing the winner", (t) => {
  const f = fixture(t);
  const explorer = f.enroll("explorer");
  const auditor = f.enroll("auditor");
  const initial = card();
  f.send(explorer, initial);
  f.send(auditor, card());
  assert.equal(f.store.one("SELECT count(*) AS n FROM cards").n, 2);
  f.send(explorer, { ...initial, base: 1, content: { ...initial.content, text: "Winner" } });
  assert.throws(
    () => f.send(explorer, { ...initial, base: 1, content: { ...initial.content, text: "Stale" } }),
    /changed/,
  );
  assert.equal(
    JSON.parse(f.store.one("SELECT content FROM cards WHERE id=?", initial.card).content).text,
    "Winner",
  );
  assert.throws(() => f.send(auditor, { ...initial, base: 2 }), /own lane/);
});
test("retries are idempotent and operation IDs cannot change meaning", (t) => {
  const f = fixture(t);
  const operation = { ...card(), id: randomUUID() };
  const first = f.send(f.owner, operation);
  assert.deepEqual(f.send(f.owner, operation), first);
  assert.equal(f.store.one("SELECT count(*) AS n FROM events WHERE kind='card.updated'").n, 1);
  assert.throws(
    () => f.send(f.owner, { ...operation, content: { ...operation.content, title: "Changed" } }),
    /reused/,
  );
});
test("auditor and approver must be distinct from the author; edits invalidate approvals", (t) => {
  const f = fixture(t);
  const explorer = f.enroll("explorer");
  const auditor = f.enroll("auditor");
  const operation = card();
  const result = f.send(explorer, operation);
  const decision = { card: operation.card, revision: result.revision, digest: result.digest };
  assert.throws(() => f.send(f.owner, { type: "approve", ...decision }), /auditor/);
  assert.throws(() => f.send(explorer, { type: "review", ...decision }), /Another member/);
  assert.throws(() => f.send(f.owner, { type: "review", ...decision }), /auditor/);
  f.send(auditor, { type: "review", ...decision });
  f.send(f.owner, { type: "approve", ...decision });
  const newer = f.send(explorer, {
    ...operation,
    base: 1,
    content: { ...operation.content, text: "Changed requirements" },
  });
  assert.throws(() => f.send(f.owner, { type: "approve", ...decision }), /changed/);
  assert.throws(() => f.send(f.owner, { type: "approve", ...decision, ...newer }), /auditor/);
  const sync = f.send(f.owner, { type: "sync", cursor: 0 });
  const view = reduceEvents({ cards: {}, activity: [] }, sync.events);
  assert.deepEqual(view.cards[operation.card].votes, {});
});
test("revocation rejects signed access, cancels invitations and invalidates audit eligibility", (t) => {
  const f = fixture(t);
  const explorer = f.enroll("explorer");
  const auditor = f.enroll("auditor");
  const operation = card();
  const result = f.send(explorer, operation);
  const decision = { card: operation.card, revision: result.revision, digest: result.digest };
  f.send(auditor, { type: "review", ...decision });
  const pending = f.invite("explorer");
  f.send(f.owner, { type: "revoke", member: auditor.id });
  assert.throws(() => f.send(f.owner, { type: "approve", ...decision }), /auditor/);
  const message = JSON.stringify({
    actor: auditor.id,
    audience: origin,
    at: Date.now(),
    nonce: randomUUID(),
    request: { type: "sync", cursor: 0 },
  });
  assert.throws(
    () =>
      f.store.authenticate({
        message,
        signature: sign("sha256", Buffer.from(message), {
          key: auditor.pair.privateKey,
          dsaEncoding: "ieee-p1363",
        }).toString("base64url"),
      }),
    /revoked/,
  );
  assert.throws(
    () => f.store.enroll({ secret: pending.secret, name: "late", key: keys().key }),
    /invalid/,
  );
  assert.throws(() => f.send(explorer, { type: "invite", role: "approver" }), /Only/);
});
test("project boundaries reject cross-project cards and do not leak events", (t) => {
  const f = fixture(t);
  const operation = card();
  f.send(f.owner, operation);
  const other = randomUUID();
  f.store.run("INSERT INTO projects VALUES(?,?)", other, "Other");
  const outsider = { ...f.actor(f.owner), project: other };
  assert.throws(
    () => f.store.dispatch(outsider, { ...operation, id: randomUUID(), base: 1 }),
    /not found/,
  );
  assert.equal(f.store.dispatch(outsider, { type: "sync", cursor: 0 }).events.length, 0);
});
test("database restart retains history and receipts for long-disconnected devices", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "schnozzle-test-"));
  let reopened;
  t.after(() => {
    if (reopened?.db.isOpen) reopened.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, "relay.sqlite");
  const f = fixture(t, path);
  const operation = { ...card(), id: randomUUID() };
  const first = f.send(f.owner, operation);
  f.store.close();
  reopened = new Store(path, origin);
  const actor = reopened.one("SELECT * FROM members WHERE id=?", f.owner.id);
  assert.deepEqual(reopened.dispatch(actor, operation), first);
  assert.ok(
    reopened
      .dispatch(actor, { type: "sync", cursor: 0 })
      .events.some((event) => event.data.id === operation.card),
  );
});
test("HTTP blocks wrong origins, wrong hosts, oversized input and unauthenticated requests", async (t) => {
  const f = fixture(t);
  const server = makeServer(f.store);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  f.store.origin = local;
  const fetchLocal = (path, options = {}) =>
    fetch(local + path, {
      ...options,
      headers: { Host: new URL(origin).host, ...options.headers },
    });
  assert.equal((await fetchLocal("/")).status, 200);
  assert.equal((await fetchLocal("/", { headers: { Origin: "https://evil.test" } })).status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    const request = httpRequest(local, { headers: { Host: "evil.test" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(wrongHost, 421);
  assert.equal(
    (
      await fetchLocal("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetchLocal("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(49000) }),
      })
    ).status,
    413,
  );
  assert.throws(() => validateOrigin("http://192.168.1.20"), /HTTPS/);
  assert.throws(() => validateOrigin("https://relay.test/path"), /path/);
  assert.equal(validateOrigin("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
});

test("support cannot erase an audit or approval", (t) => {
  const f = fixture(t);
  const explorer = f.enroll("explorer");
  const auditor = f.enroll("auditor");
  const operation = card();
  const result = f.send(explorer, operation);
  const decision = { card: operation.card, revision: result.revision, digest: result.digest };
  f.send(auditor, { type: "review", ...decision });
  f.send(auditor, { type: "endorse", ...decision });
  assert.equal(
    f.store.one("SELECT decision FROM votes WHERE actor=?", auditor.id).decision,
    "review",
  );
  f.send(f.owner, { type: "approve", ...decision });
  f.send(f.owner, { type: "endorse", ...decision });
  assert.equal(
    f.store.one("SELECT decision FROM votes WHERE actor=?", f.owner.id).decision,
    "approve",
  );
});

test("a full device budget refuses writes but leaves sync and revocation available", (t) => {
  const f = fixture(t);
  const explorer = f.enroll("explorer");
  f.store.run(
    "INSERT INTO usage VALUES(?,?) ON CONFLICT(actor) DO UPDATE SET bytes=excluded.bytes",
    explorer.id,
    10 * 1024 * 1024,
  );
  assert.throws(() => f.send(explorer, card()), /quota/);
  assert.ok(f.send(explorer, { type: "sync", cursor: 0 }).events.length);
  f.store.resetUsage(explorer.id);
  f.send(explorer, card());
  f.store.run(
    "INSERT INTO usage VALUES(?,?) ON CONFLICT(actor) DO UPDATE SET bytes=excluded.bytes",
    f.owner.id,
    10 * 1024 * 1024,
  );
  f.send(f.owner, { type: "revoke", member: explorer.id });
  assert.equal(f.store.one("SELECT revoked FROM members WHERE id=?", explorer.id).revoked, 1);
});

test("administrator recovery revokes old approvers and retains project history", (t) => {
  const f = fixture(t);
  const operation = card();
  f.send(f.owner, operation);
  const recovery = JSON.parse(
    Buffer.from(f.store.recoverApprover().slice(11), "base64url").toString(),
  );
  assert.equal(f.store.one("SELECT revoked FROM members WHERE id=?", f.owner.id).revoked, 1);
  const newOwner = f.store.enroll({
    secret: recovery.secret,
    name: "Recovered CEO",
    key: keys().key,
  });
  assert.equal(newOwner.role, "approver");
  assert.ok(
    f
      .send(newOwner, { type: "sync", cursor: 0 })
      .events.some((event) => event.data.id === operation.card),
  );
});

test("proxy client budgets isolate failed enrollment attempts", async (t) => {
  const f = fixture(t);
  const server = makeServer(f.store);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  f.store.origin = local;
  const attempt = (ip) =>
    fetch(local + "/api/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Schnozzle-Client-IP": ip },
      body: "{}",
    });
  for (let n = 0; n < 20; n++) assert.equal((await attempt("192.0.2.1")).status, 400);
  assert.equal((await attempt("192.0.2.1")).status, 429);
  assert.equal((await attempt("192.0.2.2")).status, 400);
  assert.equal(
    clientSubnet("2001:db8:1234:5678::1"),
    clientSubnet("2001:db8:1234:5678:ffff:ffff:ffff:ffff"),
  );
  for (let n = 0; n < 1600; n++)
    assert.equal((await attempt(`198.18.${Math.floor(n / 250)}.${(n % 250) + 1}`)).status, 400);
  assert.equal((await attempt("192.0.2.3")).status, 400);
});

test("a new relay epoch resets a cursor that points beyond restored history", (t) => {
  const f = fixture(t);
  const operation = card();
  f.send(f.owner, operation);
  const first = f.send(f.owner, { type: "sync", cursor: 0 });
  assert.equal(first.reset, true);
  assert.equal(
    f.send(f.owner, { type: "sync", cursor: first.cursor, epoch: first.epoch }).events.length,
    0,
  );
  f.store.epoch = randomUUID();
  const restored = f.send(f.owner, {
    type: "sync",
    cursor: first.cursor + 500,
    epoch: first.epoch,
  });
  assert.equal(restored.reset, true);
  assert.ok(restored.events.some((event) => event.data.id === operation.card));
});

test("invalid HTTP success responses never acknowledge queued work", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("proxy page", { status: 200 }));
  await assert.rejects(
    () => post("/api/request", {}),
    (error) => error.status === 502,
  );
  for (const result of [{}, { seq: 1 }, { seq: 1, revision: 2, digest: "a".repeat(64) }])
    assert.throws(
      () => validateCardReceipt(result, { base: 0 }),
      (error) => error.status === 502,
    );
  validateCardReceipt({ seq: 1, revision: 1, digest: "a".repeat(64) }, { base: 0 });
  t.mock.method(globalThis, "fetch", async () => new Response("null", { status: 401 }));
  await assert.rejects(
    () => post("/api/request", {}),
    (error) => error.status === 401,
  );
});

test("mapped IPv4 addresses keep separate rate budgets and names cannot mask device identity", (t) => {
  assert.equal(clientSubnet("::ffff:192.0.2.1"), "192.0.2.1");
  assert.equal(clientSubnet("::ffff:c000:0202"), "192.0.2.2");
  assert.equal(clientSubnet("fe80::1%eth0"), clientSubnet("fe80::2"));
  const f = fixture(t);
  const invite = f.invite("explorer");
  for (const name of ["Server administrator", "Alex\u202e", "Alex\nCEO"])
    assert.throws(() => f.store.enroll({ secret: invite.secret, name, key: keys().key }), /name/);
});
