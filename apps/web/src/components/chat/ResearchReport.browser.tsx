import "../../index.css";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { ResearchReport } from "./ResearchReport";

afterEach(cleanup);

it("renders cited reports without fetching images or exposing local and unsafe links", async () => {
  await render(
    <ResearchReport
      text={`# Findings

[Primary source](https://example.org/study)

![Tracking image](https://example.org/tracker?private=brief)

[Local file](file:///C:/private/report.txt)

[Relative route](/api/workspace-download?path=secret)

[Unsafe](javascript:alert(1))

[Credential link](https://user:password@example.org/)

<img src="https://example.org/html-tracker" />`}
    />,
  );
  await expect.element(page.getByRole("heading", { name: "Findings" })).toBeVisible();
  const links = document.querySelectorAll("a");
  expect(links).toHaveLength(1);
  expect(links[0]?.href).toBe("https://example.org/study");
  expect(links[0]?.rel).toBe("noopener noreferrer");
  expect(document.querySelectorAll("img")).toHaveLength(0);
  await expect.element(page.getByText("Tracking image")).toBeVisible();
  await expect.element(page.getByText("Local file")).toBeVisible();
});
