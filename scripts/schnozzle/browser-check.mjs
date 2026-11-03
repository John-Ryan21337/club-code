import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { Store } from "./store.mjs";
import { makeServer } from "./server.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test(
  "three people join, work offline, audit and approve the same proposal",
  { timeout: 90000 },
  async (t) => {
    const store = new Store(":memory:", "http://127.0.0.1");
    const setup = store.bootstrap();
    const server = makeServer(store);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    store.origin = origin;
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      store.close();
    });
    const contexts = await Promise.all(
      [0, 1, 2].map(() => browser.newContext({ viewport: { width: 1440, height: 1000 } })),
    );
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const [ceo, explorer, auditor] = pages;
    ceo.on("dialog", (dialog) => dialog.accept());
    const errors = [];
    for (const page of pages) page.on("pageerror", (failure) => errors.push(failure.message));
    await Promise.all(pages.map((page) => page.goto(origin)));
    await ceo.getByLabel("Your name", { exact: true }).fill("CEO · Japan");
    await ceo.getByLabel("Invitation or setup code").fill(setup);
    await ceo.getByLabel("Create the first project").check();
    await ceo.getByRole("button", { name: "Join project", exact: true }).click();
    await ceo.locator("#invite").waitFor({ state: "visible" });
    async function invite(page, name, role) {
      await ceo.getByLabel("Invite as").selectOption(role);
      await ceo.getByRole("button", { name: "Create one-use invitation" }).click();
      await ceo.waitForFunction(() =>
        document.getElementById("invitation").value.startsWith("SCHNOZZLE1."),
      );
      const code = await ceo.locator("#invitation").inputValue();
      await page.getByLabel("Your name", { exact: true }).fill(name);
      await page.getByLabel("Invitation or setup code").fill(code);
      await page.getByRole("button", { name: "Join project", exact: true }).click();
      await page.locator("#workspace").waitFor({ state: "visible" });
      await ceo.locator("#invitation").evaluate((element) => {
        element.value = "";
      });
    }
    await invite(explorer, "Field explorer · Pacific", "explorer");
    await invite(auditor, "Technical auditor · Pacific", "auditor");
    console.info("Browser stage: joined roles");
    await explorer.getByLabel("Title", { exact: true }).fill("Large field notes");
    await explorer.getByLabel("Context or proposal").fill("界".repeat(20000));
    await explorer.getByRole("button", { name: "Send it via the Amalgamating Schnozzle" }).click();
    await explorer
      .getByRole("alert")
      .getByText(/too large to send/)
      .waitFor();
    assert.equal(await explorer.locator("#outbox").innerText(), "");
    assert.equal(await explorer.getByLabel("Context or proposal").inputValue(), "界".repeat(20000));
    await explorer.waitForFunction(
      async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated",
    );
    await explorer.reload();
    await explorer.locator("#workspace").waitFor({ state: "visible" });
    await explorer.evaluate(async () => {
      for (const key of await caches.keys()) await caches.delete(key);
    });
    await explorer.reload();
    await explorer.locator("#workspace").waitFor({ state: "visible" });
    await contexts[1].setOffline(true);
    console.info("Browser stage: offline draft");
    await explorer.getByLabel("Type", { exact: true }).selectOption("proposal");
    await explorer.getByLabel("Title", { exact: true }).fill("Pickup orders without a queue");
    await explorer
      .getByLabel("Context or proposal")
      .fill(
        "Field observation: customers need a clear pickup window.\nExplore a separate scheduling lane before changing production.",
      );
    await explorer.waitForFunction(
      () => document.getElementById("draft-status").textContent === "Draft saved on this device",
    );
    await explorer.reload();
    await explorer.locator("#workspace").waitFor({ state: "visible" });
    assert.equal(
      await explorer.getByLabel("Title", { exact: true }).inputValue(),
      "Pickup orders without a queue",
    );
    await explorer.getByRole("button", { name: "Send it via the Amalgamating Schnozzle" }).click();
    await explorer
      .locator("#outbox")
      .getByText(/Waiting to send/)
      .waitFor();
    await contexts[1].setOffline(false);
    console.info("Browser stage: reconnected");
    await auditor
      .getByRole("heading", { name: "Pickup orders without a queue" })
      .waitFor({ timeout: 45000 });
    auditor.on("dialog", (dialog) => dialog.accept());
    await auditor.getByRole("button", { name: "Record audit", exact: true }).click();
    await ceo
      .locator("#cards")
      .getByText(/Technical auditor.*review/)
      .waitFor();
    await ceo.getByRole("button", { name: "Record final approval", exact: true }).click();
    await explorer
      .locator("#cards")
      .getByText(/CEO.*approve/)
      .waitFor();
    const second = await contexts[1].newPage();
    await second.goto(origin);
    await second.getByText(/already open in another tab/).waitFor();
    await second.close();
    console.info("Browser stage: approval complete");
    explorer.on("dialog", (dialog) => dialog.accept());
    await contexts[1].setOffline(true);
    await explorer.getByLabel("Title", { exact: true }).fill("Work from the previous membership");
    await explorer
      .getByLabel("Context or proposal")
      .fill("This needs review before sharing as another identity.");
    await explorer.getByRole("button", { name: "Send it via the Amalgamating Schnozzle" }).click();
    await explorer
      .locator("#outbox")
      .getByText(/Waiting to send/)
      .waitFor();
    await explorer.getByLabel("Title", { exact: true }).fill("Draft preserved after revocation");
    await explorer.getByLabel("Context or proposal").fill("Keep these field notes on this device.");
    await explorer.waitForFunction(
      () => document.getElementById("draft-status").textContent === "Draft saved on this device",
    );
    const approver = store.one("SELECT * FROM members WHERE role='approver'");
    const oldMember = store.one("SELECT * FROM members WHERE role='explorer'");
    store.dispatch(approver, { type: "revoke", id: crypto.randomUUID(), member: oldMember.id });
    await contexts[1].setOffline(false);
    await explorer
      .getByRole("button", { name: "Join with a new invitation", exact: true })
      .waitFor();
    await explorer.getByRole("button", { name: "Join with a new invitation", exact: true }).click();
    await invite(explorer, "Replacement explorer", "explorer");
    assert.equal(
      await explorer.getByRole("button", { name: "Retry original operation" }).count(),
      0,
    );
    console.info("Browser stage: replacement joined");
    assert.equal(
      await explorer.getByLabel("Title", { exact: true }).inputValue(),
      "Draft preserved after revocation",
    );
    if (process.env.SCHNOZZLE_CAPTURE_DIR) {
      mkdirSync(process.env.SCHNOZZLE_CAPTURE_DIR, { recursive: true });
      await ceo.screenshot({
        path: join(process.env.SCHNOZZLE_CAPTURE_DIR, "schnozzle-room.png"),
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    assert.equal(store.one("SELECT count(*) AS n FROM cards").n, 1);
    assert.equal(store.one("SELECT count(*) AS n FROM votes WHERE decision='approve'").n, 1);
  },
);
