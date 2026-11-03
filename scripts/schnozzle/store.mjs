import { DatabaseSync } from "node:sqlite";
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";

export class Refusal extends Error {
  constructor(status, message, code = "request_refused") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function requireValue(value, message = "Invalid request", status = 400, code) {
  if (!value) throw new Refusal(status, message, code);
}
export function string(value, max = 200) {
  requireValue(typeof value === "string" && value.trim().length > 0 && value.length <= max);
  return value;
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const roles = ["explorer", "auditor", "approver"];
const kinds = ["idea", "task", "note", "proposal", "handoff"];
const states = ["open", "working", "blocked", "done"];
const token = () => randomBytes(32).toString("base64url");

export class Store {
  constructor(path, origin, now = Date.now) {
    this.epoch = randomUUID();
    this.origin = origin;
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=3000; PRAGMA max_page_count=262144;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL, role TEXT NOT NULL, key TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS members_project ON members(project);
      CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id),
        role TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL,
        actor TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_project ON events(project,seq);
      CREATE TABLE IF NOT EXISTS cards(id TEXT PRIMARY KEY, project TEXT NOT NULL, author TEXT NOT NULL,
        revision INTEGER NOT NULL, content TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS cards_project ON cards(project,id);
      CREATE TABLE IF NOT EXISTS votes(card TEXT NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL,
        decision TEXT NOT NULL, PRIMARY KEY(card,revision,actor));
      CREATE TABLE IF NOT EXISTS receipts(actor TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL,
        result TEXT NOT NULL, PRIMARY KEY(actor,id));
      CREATE TABLE IF NOT EXISTS nonces(actor TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL,
        PRIMARY KEY(actor,nonce));
      CREATE INDEX IF NOT EXISTS nonces_expiry ON nonces(expires);
      CREATE TABLE IF NOT EXISTS bootstrap(hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS enrollments(hash TEXT PRIMARY KEY, key TEXT NOT NULL, member TEXT NOT NULL);`);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS usage(actor TEXT PRIMARY KEY, bytes INTEGER NOT NULL)",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS configuration(key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    const configured = this.one("SELECT value FROM configuration WHERE key='origin'");
    if (configured && configured.value !== origin) {
      this.db.close();
      throw new Refusal(409, "Configured origin does not match this database");
    }
    this.run("INSERT OR IGNORE INTO configuration VALUES('origin',?)", origin);
  }
  resetUsage(id) {
    requireValue(typeof id === "string" && /^[a-f0-9-]{36}$/.test(id), "Use the full device ID");
    return this.transaction(() => {
      const member = this.one("SELECT * FROM members WHERE id=?", id);
      requireValue(member, "Device was not found", 404);
      this.run("UPDATE usage SET bytes=0 WHERE actor=?", id);
      this.event(member.project, "relay-admin", "device.budget-reset", { id });
    });
  }
  close() {
    this.db.close();
  }
  one(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  transaction(action) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  bootstrap() {
    requireValue(!this.one("SELECT id FROM projects LIMIT 1"), "Relay is already initialized", 409);
    const secret = token();
    this.run("DELETE FROM bootstrap");
    this.run("INSERT INTO bootstrap(hash,expires) VALUES(?,?)", hash(secret), this.now() + 3600000);
    return secret;
  }
  event(project, actor, kind, data) {
    const at = this.now();
    const result = this.run(
      "INSERT INTO events(project,actor,at,kind,data) VALUES(?,?,?,?,?)",
      project,
      actor,
      at,
      kind,
      JSON.stringify(data),
    );
    return Number(result.lastInsertRowid);
  }
  recoverApprover() {
    return this.transaction(() => {
      const project = this.one("SELECT id FROM projects LIMIT 1");
      requireValue(project, "Initialize the relay first", 409);
      this.run("UPDATE members SET revoked=1 WHERE project=? AND role='approver'", project.id);
      this.run("DELETE FROM invites WHERE project=?", project.id);
      const secret = token();
      const expires = this.now() + 3600000;
      this.run(
        "INSERT INTO invites(hash,project,role,expires) VALUES(?,?,?,?)",
        hash(secret),
        project.id,
        "approver",
        expires,
      );
      this.event(project.id, "relay-admin", "approver.recovery", {
        message:
          "Server administrator revoked previous approver devices and issued a recovery invitation.",
      });
      return `SCHNOZZLE1.${Buffer.from(JSON.stringify({ origin: this.origin, project: project.id, secret, expires })).toString("base64url")}`;
    });
  }
  publicKey(jwk) {
    requireValue(jwk && jwk.kty === "EC" && jwk.crv === "P-256" && !jwk.d);
    requireValue(typeof jwk.x === "string" && /^[\w-]{43}$/.test(jwk.x));
    requireValue(typeof jwk.y === "string" && /^[\w-]{43}$/.test(jwk.y));
    const clean = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
    try {
      createPublicKey({ key: clean, format: "jwk" });
    } catch {
      throw new Refusal(400, "Invalid device key");
    }
    return JSON.stringify(clean);
  }
  enroll(body) {
    string(body.secret, 100);
    string(body.name, 80);
    requireValue(
      !/[\p{Cc}\p{Cf}]/u.test(body.name) &&
        body.name.trim().toLowerCase() !== "server administrator",
      "Choose a name without control characters or a reserved administrator label",
    );
    const key = this.publicKey(body.key);
    return this.transaction(() => {
      const previous = this.one("SELECT * FROM enrollments WHERE hash=?", hash(body.secret));
      if (previous) {
        requireValue(previous.key === key, "Invitation was already used", 401);
        const member = this.one(
          "SELECT id,project,role FROM members WHERE id=? AND revoked=0",
          previous.member,
        );
        requireValue(member, "Device access was revoked", 401);
        return member;
      }
      let project;
      let role;
      if (body.create === true) {
        requireValue(
          !this.one("SELECT id FROM projects LIMIT 1"),
          "Relay is already initialized",
          409,
        );
        const boot = this.one("SELECT * FROM bootstrap WHERE hash=?", hash(body.secret));
        requireValue(
          boot && !boot.used && boot.expires > this.now(),
          "Setup code is invalid or expired",
          401,
        );
        string(body.projectName, 120);
        requireValue(!/[\p{Cc}\p{Cf}]/u.test(body.projectName), "Invalid project name");
        project = randomUUID();
        role = "approver";
        this.run("INSERT INTO projects(id,name) VALUES(?,?)", project, body.projectName);
        this.run("UPDATE bootstrap SET used=1 WHERE hash=?", hash(body.secret));
      } else {
        const invite = this.one("SELECT * FROM invites WHERE hash=?", hash(body.secret));
        requireValue(
          invite && !invite.used && invite.expires > this.now(),
          "Invitation is invalid or expired",
          401,
        );
        project = invite.project;
        role = invite.role;
        requireValue(
          this.one("SELECT count(*) AS n FROM members WHERE project=? AND revoked=0", project).n <
            30,
          "Project member limit reached",
          409,
        );
        this.run("UPDATE invites SET used=1 WHERE hash=?", hash(body.secret));
      }
      const id = randomUUID();
      this.run(
        "INSERT INTO members(id,project,name,role,key) VALUES(?,?,?,?,?)",
        id,
        project,
        body.name,
        role,
        key,
      );
      this.run("INSERT INTO enrollments VALUES(?,?,?)", hash(body.secret), key, id);
      this.event(project, id, "member.joined", { id, name: body.name, role });
      return { id, project, role };
    });
  }
  authenticate(envelope, admit = () => {}) {
    requireValue(
      envelope && typeof envelope.message === "string" && envelope.message.length <= 40000,
    );
    string(envelope.signature, 100);
    let message;
    try {
      message = JSON.parse(envelope.message);
    } catch {
      throw new Refusal(400, "Invalid message");
    }
    string(message.actor, 50);
    string(message.nonce, 50);
    requireValue(
      message.audience === this.origin &&
        Number.isSafeInteger(message.at) &&
        Math.abs(this.now() - message.at) < 300000,
      "Request time or relay address is invalid",
      401,
      "request_binding",
    );
    const actor = this.one("SELECT * FROM members WHERE id=? AND revoked=0", message.actor);
    requireValue(actor, "Device access was revoked or is unknown", 401, "device_revoked");
    const valid = verify(
      "sha256",
      Buffer.from(envelope.message),
      {
        key: createPublicKey({ key: JSON.parse(actor.key), format: "jwk" }),
        dsaEncoding: "ieee-p1363",
      },
      Buffer.from(envelope.signature, "base64url"),
    );
    requireValue(valid, "Invalid device signature", 401);
    requireValue(
      !this.one("SELECT 1 FROM nonces WHERE actor=? AND nonce=?", actor.id, message.nonce),
      "Request was already used",
      409,
    );
    admit(actor);
    this.run("DELETE FROM nonces WHERE expires<?", this.now());
    this.run("INSERT INTO nonces VALUES(?,?,?)", actor.id, message.nonce, this.now() + 600000);
    return { actor, request: message.request };
  }
  dispatch(actor, request) {
    requireValue(request && typeof request === "object");
    if (request.type === "sync") {
      requireValue(Number.isSafeInteger(request.cursor) && request.cursor >= 0);
      const reset = request.epoch !== this.epoch;
      const cursor = reset ? 0 : request.cursor;
      const events = this.all(
        "SELECT * FROM events WHERE project=? AND seq>? ORDER BY seq LIMIT 100",
        actor.project,
        cursor,
      ).map((event) => ({ ...event, data: JSON.parse(event.data) }));
      return {
        project: this.one("SELECT * FROM projects WHERE id=?", actor.project),
        actor: actor.id,
        epoch: this.epoch,
        reset,
        events,
        cursor: events.at(-1)?.seq ?? cursor,
        more: events.length === 100,
        members: this.all(
          "SELECT id,name,role,revoked FROM members WHERE project=?",
          actor.project,
        ),
      };
    }
    string(request.id, 50);
    // Compare operation meaning, independent of JSON property order or transport metadata.
    const fingerprint = hash(
      JSON.stringify({
        type: request.type,
        id: request.id,
        card: request.card,
        base: request.base,
        role: request.role,
        member: request.member,
        revision: request.revision,
        digest: request.digest,
        content: request.content && {
          kind: request.content.kind,
          state: request.content.state,
          title: request.content.title,
          text: request.content.text,
          lane: request.content.lane,
        },
      }),
    );
    return this.transaction(() => {
      const previous = this.one(
        "SELECT * FROM receipts WHERE actor=? AND id=?",
        actor.id,
        request.id,
      );
      if (previous) {
        requireValue(
          previous.hash === fingerprint,
          "Operation ID was reused for different content",
          409,
        );
        return JSON.parse(previous.result);
      }
      const result = this.mutate(actor, request);
      // Do not retain invitation bearer secrets in the database, even in idempotency receipts.
      const receipt =
        request.type === "invite"
          ? {
              invitation: null,
              message: "Invitation already created. Create another if its response was lost.",
            }
          : result;
      this.run(
        "INSERT INTO receipts VALUES(?,?,?,?)",
        actor.id,
        request.id,
        fingerprint,
        JSON.stringify(receipt),
      );
      return result;
    });
  }
  mutate(actor, request) {
    const { type } = request;
    // Budget retained history and receipts. Reserve space for revocation and sync.
    if (type !== "revoke") {
      const usedPages =
        this.one("PRAGMA page_count").page_count - this.one("PRAGMA freelist_count").freelist_count;
      requireValue(
        usedPages * this.one("PRAGMA page_size").page_size < 512 * 1024 * 1024,
        "Relay storage quota reached. Ask the server administrator to archive this project.",
        507,
      );
      const cost = Buffer.byteLength(JSON.stringify(request)) * 2 + 4096;
      const used = this.one("SELECT bytes FROM usage WHERE actor=?", actor.id)?.bytes ?? 0;
      requireValue(
        used + cost <= 10 * 1024 * 1024,
        "Device history quota reached. Ask the server administrator to reset this device's usage budget.",
        507,
      );
      this.run(
        "INSERT INTO usage VALUES(?,?) ON CONFLICT(actor) DO UPDATE SET bytes=excluded.bytes",
        actor.id,
        used + cost,
      );
    }
    if (type === "invite") {
      requireValue(actor.role === "approver", "Only the project approver can invite members", 403);
      requireValue(roles.includes(request.role));
      this.run("DELETE FROM invites WHERE expires<? OR used=1", this.now());
      requireValue(
        this.one("SELECT count(*) AS n FROM invites WHERE project=?", actor.project).n < 30,
        "Too many open invitations",
        429,
      );
      const secret = token();
      const expires = this.now() + 86400000;
      this.run(
        "INSERT INTO invites(hash,project,role,expires) VALUES(?,?,?,?)",
        hash(secret),
        actor.project,
        request.role,
        expires,
      );
      this.event(actor.project, actor.id, "invitation.created", { role: request.role, expires });
      // The invitation secret is returned once. Only its hash is persisted.
      return {
        invitation: `SCHNOZZLE1.${Buffer.from(JSON.stringify({ origin: this.origin, project: actor.project, secret, expires })).toString("base64url")}`,
      };
    }
    if (type === "revoke") {
      requireValue(actor.role === "approver", "Only the project approver can revoke devices", 403);
      requireValue(request.member !== actor.id, "You cannot revoke your current device", 409);
      const target = this.one(
        "SELECT * FROM members WHERE project=? AND id=? AND revoked=0",
        actor.project,
        string(request.member, 50),
      );
      requireValue(target, "Member was not found", 404);
      this.run("UPDATE members SET revoked=1 WHERE id=?", target.id);
      // An outstanding invitation must not survive a membership revocation.
      this.run("DELETE FROM invites WHERE project=?", actor.project);
      return { seq: this.event(actor.project, actor.id, "member.revoked", { id: target.id }) };
    }
    if (type === "card") {
      string(request.card, 50);
      requireValue(Number.isSafeInteger(request.base) && request.base >= 0);
      const content = request.content;
      requireValue(content && kinds.includes(content.kind) && states.includes(content.state));
      string(content.title, 160);
      string(content.text, 24000);
      string(content.lane, 80);
      const prior = this.one("SELECT * FROM cards WHERE id=?", request.card);
      requireValue(!prior || prior.project === actor.project, "Card was not found", 404);
      requireValue(
        (prior?.revision ?? 0) === request.base,
        "This card changed. Keep your draft and compare the current version.",
        409,
      );
      requireValue(
        !prior || prior.author === actor.id,
        "Each member edits their own lane. Create a new proposal to suggest changes.",
        403,
      );
      const clean = {
        kind: content.kind,
        state: content.state,
        title: content.title,
        text: content.text,
        lane: content.lane,
      };
      const serialized = JSON.stringify(clean);
      const digest = hash(serialized);
      const revision = request.base + 1;
      if (!prior)
        requireValue(
          this.one("SELECT count(*) AS n FROM cards WHERE project=?", actor.project).n < 10000,
          "Project card limit reached",
          409,
        );
      this.run(
        `INSERT INTO cards VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        revision=excluded.revision,content=excluded.content,digest=excluded.digest`,
        request.card,
        actor.project,
        actor.id,
        revision,
        serialized,
        digest,
      );
      return {
        seq: this.event(actor.project, actor.id, "card.updated", {
          id: request.card,
          author: actor.id,
          revision,
          digest,
          content: clean,
        }),
        revision,
        digest,
      };
    }
    if (type === "review" || type === "approve" || type === "endorse") {
      const card = this.one(
        "SELECT * FROM cards WHERE project=? AND id=?",
        actor.project,
        string(request.card, 50),
      );
      requireValue(card, "Card was not found", 404);
      requireValue(
        request.revision === card.revision && request.digest === card.digest,
        "The content changed. Review the new version.",
        409,
      );
      requireValue(card.author !== actor.id, "Another member must review this work", 403);
      const earlier = this.one(
        "SELECT decision FROM votes WHERE card=? AND revision=? AND actor=?",
        card.id,
        card.revision,
        actor.id,
      );
      // Supporting an idea must not erase an audit or approval.
      if (type === "endorse" && earlier && earlier.decision !== "endorse")
        return { unchanged: true };
      if (type !== "endorse")
        requireValue(
          JSON.parse(card.content).kind === "proposal",
          "Only proposals can be approved",
          409,
        );
      if (type === "review")
        requireValue(actor.role === "auditor", "An auditor must review this proposal", 403);
      if (type === "approve") {
        requireValue(
          actor.role === "approver",
          "The project approver must approve this proposal",
          403,
        );
        requireValue(
          this.one(
            `SELECT 1 FROM votes v JOIN members m ON m.id=v.actor
          WHERE v.card=? AND v.revision=? AND v.decision='review' AND m.revoked=0 AND m.role='auditor' AND m.id<>?`,
            card.id,
            card.revision,
            actor.id,
          ),
          "An active auditor must review this exact version first",
          409,
        );
      }
      this.run(
        "INSERT INTO votes VALUES(?,?,?,?) ON CONFLICT(card,revision,actor) DO UPDATE SET decision=excluded.decision",
        card.id,
        card.revision,
        actor.id,
        type,
      );
      return {
        seq: this.event(actor.project, actor.id, `card.${type}`, {
          id: card.id,
          revision: card.revision,
          digest: card.digest,
        }),
      };
    }
    throw new Refusal(400, "Unknown operation");
  }
}
