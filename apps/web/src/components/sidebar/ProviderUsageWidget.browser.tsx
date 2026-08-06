import "../../index.css";

import { page, userEvent } from "vitest/browser";
import { beforeEach, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import {
  MIN_PROVIDER_USAGE_HEIGHT_PX,
  PROVIDER_USAGE_HEIGHT_STORAGE_KEY,
  ProviderUsageScrollRegion,
} from "./ProviderUsageWidget";

beforeEach(() => {
  window.localStorage.removeItem(PROVIDER_USAGE_HEIGHT_STORAGE_KEY);
});

it("bounds tall provider usage so the thread region remains reachable", async () => {
  await page.viewport(390, 500);
  await render(
    <div className="flex h-svh flex-col">
      <ProviderUsageScrollRegion>
        <div className="h-[800px]">Expanded provider usage</div>
      </ProviderUsageScrollRegion>
      <div className="min-h-0 flex-1" data-testid="thread-region">
        Threads
      </div>
    </div>,
  );

  const usage = document.querySelector<HTMLElement>('[data-slot="provider-usage-widget"]');
  const threads = document.querySelector<HTMLElement>('[data-testid="thread-region"]');
  expect(usage).not.toBeNull();
  expect(threads).not.toBeNull();
  expect(document.querySelector('[data-slot="provider-usage-resizer"]')).toBeNull();
  expect(usage!.scrollHeight).toBeGreaterThan(usage!.clientHeight);
  expect(usage!.clientHeight).toBeLessThanOrEqual(150);
  expect(threads!.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(threads!.getBoundingClientRect().bottom).toBeLessThanOrEqual(500);
});

it("lets desktop operators resize the provider/thread split and persists keyboard changes", async () => {
  await page.viewport(900, 800);
  await render(
    <div className="flex h-svh flex-col">
      <ProviderUsageScrollRegion>
        <div className="h-[800px]">Expanded provider usage</div>
      </ProviderUsageScrollRegion>
      <div className="min-h-0 flex-1" data-testid="thread-region">
        Threads
      </div>
    </div>,
  );

  const usage = document.querySelector<HTMLElement>('[data-slot="provider-usage-widget"]');
  const resizer = document.querySelector<HTMLElement>('[data-slot="provider-usage-resizer"]');
  const threads = document.querySelector<HTMLElement>('[data-testid="thread-region"]');
  expect(usage).not.toBeNull();
  expect(resizer).not.toBeNull();
  expect(threads).not.toBeNull();

  const initialHeight = usage!.getBoundingClientRect().height;
  resizer!.focus();
  await userEvent.keyboard("{ArrowUp}");

  expect(usage!.getBoundingClientRect().height).toBeLessThan(initialHeight);
  expect(Number(window.localStorage.getItem(PROVIDER_USAGE_HEIGHT_STORAGE_KEY))).toBe(
    initialHeight - 32,
  );
  expect(usage!.getBoundingClientRect().height).toBeGreaterThanOrEqual(
    MIN_PROVIDER_USAGE_HEIGHT_PX,
  );
  expect(threads!.getBoundingClientRect().height).toBeGreaterThan(0);
});
