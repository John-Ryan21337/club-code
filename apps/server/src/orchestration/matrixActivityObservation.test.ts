import { describe, expect, it } from "vitest";

import { classifyMatrixActivityObservation } from "./matrixActivityObservation.ts";

const observation = (activityType: "network" | "database" | "build") => ({
  providerObserved: true,
  activityType,
});

describe("classifyMatrixActivityObservation", () => {
  it("classifies canonical web searches without inspecting provider content", () => {
    const result = classifyMatrixActivityObservation({
      itemType: "web_search",
      data: {
        item: { type: "webSearch" },
        query: "credential=secret",
        url: "https://private.example.test/build/database",
      },
    });

    expect(result).toEqual(observation("network"));
    expect(Object.keys(result ?? {}).toSorted()).toEqual(["activityType", "providerObserved"]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it.each([
    { item: { type: "webSearch" } },
    { toolName: "WebSearch" },
    { toolName: "WebFetch" },
    { tool: "websearch" },
    { tool: "webfetch" },
    { tool: "web_navigate" },
  ])("requires an exact provider web-tool identity for canonical web searches", (data) => {
    expect(
      classifyMatrixActivityObservation({
        itemType: "web_search",
        data,
      }),
    ).toEqual(observation("network"));
  });

  it.each([
    undefined,
    {},
    { query: "private query" },
    { item: { type: "myWebSearchLogger" } },
    { toolName: "MyWebSearchLogger" },
    { tool: "webpack" },
    { item: { type: "webSearch" }, toolName: "MyWebSearchLogger" },
    { item: { type: "webSearch" }, tool: "postgres_query" },
  ])("fails closed for inexact or conflicting canonical web-tool identity %#", (data) => {
    expect(
      classifyMatrixActivityObservation({
        itemType: "web_search",
        data,
      }),
    ).toBeUndefined();
  });

  it.each([
    ["curl https://example.test", "network"],
    ['"C:\\Program Files\\curl.exe" --head https://example.test', "network"],
    ["/usr/bin/wget https://example.test/archive", "network"],
    ["Invoke-WebRequest https://example.test", "network"],
    ["psql postgresql://localhost/app", "database"],
    ["C:\\tools\\sqlite3.exe app.db", "database"],
    ["duckdb warehouse.db", "database"],
    ["tsc --build", "build"],
    ["/usr/bin/make all", "build"],
    ["cmake --build out", "build"],
    ["vite build", "build"],
    ["cargo check", "build"],
    ["go build ./...", "build"],
    ["dotnet publish App.csproj", "build"],
    ["swift build", "build"],
    ["gradlew.bat assemble", "build"],
    ["mvnw.cmd package", "build"],
    ["python -m build", "build"],
    ["npm run build", "build"],
    ["yarn bundle", "build"],
    ["pnpm compile", "build"],
    ["corepack yarn build:desktop", "build"],
    ["yarn workspace @cafecode/web build", "build"],
    ["corepack yarn workspace @cafecode/web typecheck", "build"],
    ["pnpm run compile:contracts", "build"],
    ["npm run bundle:web", "build"],
    ["npx vite build", "build"],
    ["corepack yarn build", "build"],
    ["docker build .", "build"],
    ["docker pull node:latest", "network"],
    ["git fetch origin", "network"],
  ] as const)("classifies the recognized command invocation %s", (command, activityType) => {
    expect(
      classifyMatrixActivityObservation({
        itemType: "command_execution",
        data: { command },
      }),
    ).toEqual(observation(activityType));
  });

  it("supports the bounded Codex and Claude sanitized command shapes", () => {
    expect(
      classifyMatrixActivityObservation({
        itemType: "command_execution",
        data: { item: { command: "curl https://example.test" } },
      }),
    ).toEqual(observation("network"));
    expect(
      classifyMatrixActivityObservation({
        itemType: "command_execution",
        data: { toolName: "Bash", input: { command: "sqlite3 app.db" } },
      }),
    ).toEqual(observation("database"));
  });

  it.each([
    [
      '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "corepack yarn typecheck"',
      "build",
    ],
    [
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -Command 'corepack yarn build:desktop'",
      "build",
    ],
    [
      '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "curl https://example.test"',
      "network",
    ],
    [
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -command 'sqlite3 app.db'",
      "database",
    ],
    ["pwsh.exe -Command 'corepack yarn workspace @cafecode/web typecheck'", "build"],
  ] as const)(
    "classifies one exact Windows PowerShell wrapper without retaining its command: %s",
    (command, activityType) => {
      expect(
        classifyMatrixActivityObservation({
          itemType: "command_execution",
          data: { item: { command } },
        }),
      ).toEqual(observation(activityType));
    },
  );

  it.each(["pending", "running", "completed"])(
    "supports the real OpenCode command shape in %s state",
    (status) => {
      expect(
        classifyMatrixActivityObservation({
          itemType: "command_execution",
          data: {
            tool: "bash",
            state: {
              status,
              input: { command: "corepack yarn build:desktop" },
            },
          },
        }),
      ).toEqual(observation("build"));
    },
  );

  it.each([
    [{ toolName: "WebSearch" }, "network"],
    [{ toolName: "ExecuteSQL" }, "database"],
    [{ toolName: "BuildProject" }, "build"],
    [{ toolName: "mcp__postgres__query" }, "database"],
    [{ toolName: "mcp__playwright__navigate" }, "network"],
    [{ item: { server: "compiler", tool: "compile" } }, "build"],
    [{ item: { server: "sqlite", tool: "execute_sql" } }, "database"],
    [{ item: { server: "browser", tool: "open_url" } }, "network"],
    [{ item: { tool: "BuildProject" } }, "build"],
  ] as const)("classifies an exact structured provider identity", (data, activityType) => {
    expect(
      classifyMatrixActivityObservation({
        itemType: "dynamic_tool_call",
        data,
      }),
    ).toEqual(observation(activityType));
  });

  it.each([
    ["playwright_navigate", "network"],
    ["playwright_browser_navigate", "network"],
    ["fetch_fetch", "network"],
    ["postgres_query", "database"],
    ["sqlite_execute_sql", "database"],
    ["compiler_compile", "build"],
  ] as const)("classifies the exact OpenCode combined MCP identity %s", (tool, activityType) => {
    expect(
      classifyMatrixActivityObservation({
        itemType: "dynamic_tool_call",
        data: {
          tool,
          state: {
            status: "completed",
            input: { credential: "private-provider-input" },
            output: "private-provider-output",
            title: "Private provider title",
            metadata: {},
            time: { start: 1_000, end: 2_000 },
          },
        },
      }),
    ).toEqual(observation(activityType));
  });

  it.each([
    {
      status: "pending",
      input: { url: "https://private.example.test" },
      raw: '{"url":"https://private.example.test"}',
    },
    {
      status: "running",
      input: { url: "https://private.example.test" },
      title: "Navigating to a private URL",
      time: { start: 1_000 },
    },
    {
      status: "completed",
      input: { url: "https://private.example.test" },
      output: "private response",
      title: "Navigation completed",
      metadata: {},
      time: { start: 1_000, end: 2_000 },
    },
  ])("classifies a real OpenCode MCP tool shape in $status state", (state) => {
    const result = classifyMatrixActivityObservation({
      itemType: "dynamic_tool_call",
      data: {
        tool: "playwright_navigate",
        state,
      },
    });

    expect(result).toEqual(observation("network"));
    expect(JSON.stringify(result)).not.toMatch(/private|url|response|navigation/iu);
  });

  it.each([
    "echo C:\\projects\\network\\curl.exe",
    "node /tmp/database/build.js",
    "rg curl https://example.test/database",
    "printf 'SELECT * FROM build_network'",
    "echo postgres_password=secret",
    "curlish https://example.test",
    "https://example.test/curl",
    "bash -lc 'curl https://example.test'",
    "powershell -Command Invoke-WebRequest https://example.test",
    "git status --short",
    "docker inspect build-container",
    "cargo test",
    "vite dev",
    "npm test -- /tmp/build.test.ts",
    "corepack yarn test -- /tmp/build.test.ts",
    "yarn workspace @cafecode/web lint",
    "corepack yarn workspace @cafecode/web dev",
    "npm run build/desktop",
  ])(
    "does not infer a category from an argument, path, URL, SQL, or freeform text: %s",
    (command) => {
      expect(
        classifyMatrixActivityObservation({
          itemType: "command_execution",
          data: { command },
        }),
      ).toBeUndefined();
    },
  );

  it.each([
    "powershell -Command 'corepack yarn build:desktop'",
    "powershell.exe corepack yarn build:desktop",
    "powershell.exe -NoProfile -Command 'corepack yarn build:desktop'",
    "powershell.exe -EncodedCommand YwB1AHIAbAA=",
    "powershell.exe -Command corepack yarn build:desktop",
    "powershell.exe -Command 'corepack yarn build:desktop' trailing",
    "powershell.exe -Command 'corepack yarn build:desktop; curl https://example.test'",
    "powershell.exe -Command 'corepack yarn build:desktop && curl https://example.test'",
    "powershell.exe -Command 'corepack yarn build:desktop | Out-Null'",
    "powershell.exe -Command '& corepack yarn build:desktop'",
    "powershell.exe -Command '$(corepack yarn build:desktop)'",
    "powershell.exe -Command '@(corepack yarn build:desktop)'",
    "powershell.exe -Command 'curl $env:PRIVATE_URL'",
    "powershell.exe -Command 'curl ${env:PRIVATE_URL}'",
    "powershell.exe -Command 'curl (Get-PrivateUrl)'",
    "powershell.exe -Command ' corepack yarn build:desktop'",
    "powershell.exe -Command 'corepack yarn build:desktop '",
    "powershell.exe\u00a0-Command 'corepack yarn build:desktop'",
    "powershell.exe -Command 'curl \"$(corepack yarn build:desktop)\"'",
    "powershell.exe -Command 'curl \"${env:PRIVATE_URL}\"'",
    "powershell.exe -Command 'corepack yarn build:desktop > build.log'",
    "powershell.exe -Command 'corepack yarn \"build:desktop'",
    "cmd.exe /c 'corepack yarn build:desktop'",
    "bash -lc 'corepack yarn build:desktop'",
  ])("rejects a non-canonical or ambiguous Windows command wrapper: %s", (command) => {
    expect(
      classifyMatrixActivityObservation({
        itemType: "command_execution",
        data: { command },
      }),
    ).toBeUndefined();
  });

  it.each([
    { toolName: "MyWebSearchLogger" },
    { toolName: "Read", input: { path: "/tmp/network/database/build" } },
    { toolName: "Bash", input: { prompt: "please curl then build" } },
    { item: { server: "notes", tool: "query", arguments: { sql: "select * from users" } } },
    { item: { server: "postgres", tool: "read_file", path: "/tmp/execute_sql" } },
    { item: { server: "build", tool: "query" } },
    { nested: { toolName: "ExecuteSQL" } },
    { toolName: "/tmp/web_search" },
    { toolName: "web??search" },
    { toolName: `web_search_${"x".repeat(128)}` },
    { tool: "my_playwright_navigate" },
    { tool: "playwright_navigate_logger" },
    { tool: "playwright__navigate" },
    { tool: "playwright.navigate" },
    { tool: "postgres__query" },
    { tool: "postgres.query" },
    { tool: "unknown_query" },
    { tool: "notes_query" },
    { tool: "postgres_read_file" },
    { tool: "playwright_query" },
    { tool: "postgres_navigate" },
  ])("fails closed for unknown or ambiguous structured data", (data) => {
    expect(
      classifyMatrixActivityObservation({
        itemType: "dynamic_tool_call",
        data,
      }),
    ).toBeUndefined();
  });

  it("fails closed when duplicate command fields conflict", () => {
    expect(
      classifyMatrixActivityObservation({
        itemType: "command_execution",
        data: {
          command: "curl https://example.test",
          item: { command: "sqlite3 app.db" },
        },
      }),
    ).toBeUndefined();
    expect(
      classifyMatrixActivityObservation({
        itemType: "command_execution",
        data: {
          command:
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -Command 'corepack yarn build:desktop'",
          item: { command: "corepack yarn build:desktop" },
        },
      }),
    ).toBeUndefined();
  });

  it("fails closed when structured identities conflict", () => {
    expect(
      classifyMatrixActivityObservation({
        itemType: "dynamic_tool_call",
        data: {
          toolName: "ExecuteSQL",
          tool: "BuildProject",
        },
      }),
    ).toBeUndefined();
    expect(
      classifyMatrixActivityObservation({
        itemType: "mcp_tool_call",
        data: {
          toolName: "BuildProject",
          item: { server: "sqlite", tool: "execute_sql" },
        },
      }),
    ).toBeUndefined();
    expect(
      classifyMatrixActivityObservation({
        itemType: "dynamic_tool_call",
        data: {
          server: "compiler",
          tool: "compile",
          item: { server: "sqlite", tool: "query" },
        },
      }),
    ).toBeUndefined();
  });

  it("does not classify provider data outside its canonical item-type boundary", () => {
    expect(
      classifyMatrixActivityObservation({
        itemType: "file_change",
        data: { command: "curl https://example.test", toolName: "BuildProject" },
      }),
    ).toBeUndefined();
    expect(
      classifyMatrixActivityObservation({
        itemType: "command_execution",
        data: { toolName: "ExecuteSQL" },
      }),
    ).toBeUndefined();
    expect(
      classifyMatrixActivityObservation({
        itemType: "dynamic_tool_call",
        data: { input: { command: "curl https://example.test" } },
      }),
    ).toBeUndefined();
  });

  it("rejects unbounded, malformed, and non-string commands", () => {
    expect(
      classifyMatrixActivityObservation({
        itemType: "command_execution",
        data: { command: `curl ${"x".repeat(4_096)}` },
      }),
    ).toBeUndefined();
    expect(
      classifyMatrixActivityObservation({
        itemType: "command_execution",
        data: { command: '"curl https://example.test' },
      }),
    ).toBeUndefined();
    expect(
      classifyMatrixActivityObservation({
        itemType: "command_execution",
        data: { command: ["curl", "https://example.test"] },
      }),
    ).toBeUndefined();
    expect(
      classifyMatrixActivityObservation({
        itemType: "command_execution",
        data: {
          command: 123,
          item: { command: "curl https://example.test" },
        },
      }),
    ).toBeUndefined();
    expect(
      classifyMatrixActivityObservation({
        itemType: "command_execution",
        data: { command: "curl\nhttps://example.test" },
      }),
    ).toBeUndefined();
  });

  it("returns only the fixed privacy-safe projection for credential-bearing commands", () => {
    const secret = "super-private-token";
    const result = classifyMatrixActivityObservation({
      itemType: "command_execution",
      data: {
        command: `curl -H "Authorization: Bearer ${secret}" https://private.example.test`,
        itemId: "provider-secret-id",
        prompt: "private prompt",
      },
    });

    expect(result).toEqual(observation("network"));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("provider-secret-id");
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("private.example.test");
  });
});
