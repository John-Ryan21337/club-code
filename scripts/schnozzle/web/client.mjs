// Private keys, drafts, history and the outbox stay in this origin's IndexedDB.
// No provider token or repository credential enters this application.
export async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("schnozzle-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Browser storage is unavailable"));
  });
}
export function read(db, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction("state").objectStore("state").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function write(db, key, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("state", "readwrite");
    transaction.objectStore("state").put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export async function identity(db) {
  let value = await read(db, "identity");
  if (!value) {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]);
    value = {
      privateKey: keys.privateKey,
      key: await crypto.subtle.exportKey("jwk", keys.publicKey),
    };
    await write(db, "identity", value);
  }
  return value;
}
export async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new Error(
      `Relay returned an invalid response (${response.status}). Delivery is unconfirmed.`,
    );
    error.status = response.ok ? 502 : response.status;
    throw error;
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    const error = new Error("Relay returned an invalid response");
    error.status = response.ok ? 502 : response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(result.error ?? "Request failed");
    error.status = response.status;
    error.code = result.code;
    throw error;
  }
  return result;
}
export async function request(device, member, action) {
  const message = JSON.stringify({
    actor: member.id,
    audience: location.origin,
    at: Date.now(),
    nonce: crypto.randomUUID(),
    request: action,
  });
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    device.privateKey,
    new TextEncoder().encode(message),
  );
  const body = {
    message,
    signature: btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", ""),
  };
  checkRequestSize(body);
  const result = await post("/api/request", body);
  if (action.type === "card") validateCardReceipt(result, action);
  return result;
}
export function validateCardReceipt(result, action) {
  if (
    !Number.isSafeInteger(result.seq) ||
    result.seq < 1 ||
    result.revision !== action.base + 1 ||
    typeof result.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(result.digest)
  ) {
    const error = new Error("Relay did not confirm this card. Delivery is unconfirmed.");
    error.status = 502;
    throw error;
  }
}
function checkRequestSize(body) {
  if (
    body.message.length > 40000 ||
    new TextEncoder().encode(JSON.stringify(body)).length > 48000
  ) {
    const error = new Error(
      "This card is too large to send. Shorten it or split it into separate cards.",
    );
    error.status = 413;
    throw error;
  }
}
export function checkOperationSize(member, action) {
  checkRequestSize({
    message: JSON.stringify({
      actor: member.id,
      audience: location.origin,
      at: Date.now(),
      nonce: crypto.randomUUID(),
      request: action,
    }),
    signature: "x".repeat(86),
  });
}
export function invitation(text) {
  if (!text.startsWith("SCHNOZZLE1.") || text.length > 3000)
    throw new Error("Paste a complete Schnozzle invitation");
  let value;
  try {
    value = JSON.parse(atob(text.slice(11).replaceAll("-", "+").replaceAll("_", "/")));
  } catch {
    throw new Error("The invitation is invalid");
  }
  if (value.origin !== location.origin)
    throw new Error(
      `Open the relay address supplied by your teammate, then paste the invitation there. This invitation is for ${String(value.origin).slice(0, 200)}.`,
    );
  // Let the server recover an already accepted enrollment even after the invitation expires.
  if (typeof value.secret !== "string") throw new Error("The invitation is invalid");
  return value;
}
export function reduceEvents(view, events) {
  for (const event of events) {
    if (event.kind === "card.updated")
      view.cards[event.data.id] = { ...event.data, at: event.at, votes: {} };
    else if (["card.review", "card.approve", "card.endorse"].includes(event.kind)) {
      const card = view.cards[event.data.id];
      if (card && card.revision === event.data.revision)
        card.votes[event.actor] = event.kind.slice(5);
    }
    view.activity.unshift(event);
  }
  view.activity = view.activity.slice(0, 150);
  return view;
}
