import "../../index.css";

import { page } from "vitest/browser";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { ProviderUsageScrollRegion } from "./ProviderUsageWidget";

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
  expect(usage!.scrollHeight).toBeGreaterThan(usage!.clientHeight);
  expect(usage!.clientHeight).toBeLessThanOrEqual(210);
  expect(threads!.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(threads!.getBoundingClientRect().bottom).toBeLessThanOrEqual(500);
});
