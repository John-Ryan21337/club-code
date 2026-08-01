import type { CanonicalItemType } from "@cafecode/contracts";

export type MatrixActivityType = "network" | "database" | "build" | "agent";

export interface MatrixActivityObservation {
  readonly providerObserved: true;
  readonly activityType: MatrixActivityType;
}

export interface MatrixActivityObservationInput {
  readonly itemType: CanonicalItemType;
  readonly data?: unknown;
}

const MAX_STRUCTURED_IDENTITY_LENGTH = 128;
const MAX_COMMAND_LENGTH = 4_096;
const MAX_COMMAND_TOKEN_LENGTH = 512;
const MAX_COMMAND_TOKENS = 6;
const WINDOWS_POWERSHELL_EXECUTABLES = new Set(["powershell.exe", "pwsh.exe"]);
const WINDOWS_POWERSHELL_HEADLESS_NULL_PIPE_PREFIX = "$null | ";
const SAFE_UNQUOTED_NPM_SCOPE_TOKEN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/iu;

const OBSERVATIONS = {
  network: Object.freeze({
    providerObserved: true,
    activityType: "network",
  }),
  database: Object.freeze({
    providerObserved: true,
    activityType: "database",
  }),
  build: Object.freeze({
    providerObserved: true,
    activityType: "build",
  }),
  agent: Object.freeze({
    providerObserved: true,
    activityType: "agent",
  }),
} as const satisfies Record<MatrixActivityType, MatrixActivityObservation>;

const STANDALONE_TOOL_IDENTITIES = new Map<string, MatrixActivityType>([
  ["web_search", "network"],
  ["web_fetch", "network"],
  ["fetch_url", "network"],
  ["http_request", "network"],
  ["browser_navigate", "network"],
  ["browser_open_url", "network"],
  ["execute_sql", "database"],
  ["run_sql", "database"],
  ["database_query", "database"],
  ["postgres_query", "database"],
  ["postgresql_query", "database"],
  ["sqlite_query", "database"],
  ["mysql_query", "database"],
  ["mariadb_query", "database"],
  ["mongodb_query", "database"],
  ["redis_query", "database"],
  ["build", "build"],
  ["compile", "build"],
  ["bundle", "build"],
  ["build_project", "build"],
  ["run_build", "build"],
  ["compile_project", "build"],
  ["bundle_project", "build"],
]);

const EXACT_WEB_TOOL_IDENTITIES = new Set(["web_search", "web_fetch", "websearch", "webfetch"]);

const SERVER_TOOL_IDENTITIES: Readonly<
  Record<
    MatrixActivityType,
    {
      readonly servers: ReadonlySet<string>;
      readonly tools: ReadonlySet<string>;
    }
  >
> = {
  network: {
    servers: new Set(["browser", "fetch", "http", "playwright", "puppeteer", "web"]),
    tools: new Set([
      "browser_navigate",
      "browser_open_url",
      "fetch",
      "fetch_url",
      "http_request",
      "navigate",
      "navigate_to",
      "open_url",
      "request",
    ]),
  },
  database: {
    servers: new Set([
      "duckdb",
      "mariadb",
      "mongodb",
      "mysql",
      "postgres",
      "postgresql",
      "redis",
      "sqlite",
      "supabase",
    ]),
    tools: new Set(["execute_query", "execute_sql", "query", "run_query", "run_sql"]),
  },
  build: {
    servers: new Set(["build", "bundler", "compiler"]),
    tools: new Set([
      "build",
      "build_project",
      "bundle",
      "bundle_project",
      "compile",
      "compile_project",
    ]),
  },
  // Agent communication uses one exact canonical lifecycle item type below;
  // arbitrary MCP server/tool names must not be reinterpreted as orchestration.
  agent: {
    servers: new Set(),
    tools: new Set(),
  },
};

/**
 * OpenCode 1.18.3's MCP catalog sanitizes the server and tool names
 * independently, then joins them with exactly one underscore. Precomputing
 * every allowed pair avoids guessing where that separator falls when either
 * side contains its own underscores.
 */
const OPENCODE_COMBINED_MCP_IDENTITIES: ReadonlyMap<string, MatrixActivityType | null> = (() => {
  const identities = new Map<string, MatrixActivityType | null>();
  for (const activityType of ["network", "database", "build"] as const) {
    const allowlist = SERVER_TOOL_IDENTITIES[activityType];
    for (const server of allowlist.servers) {
      for (const tool of allowlist.tools) {
        const identity = `${server}_${tool}`;
        const existing = identities.get(identity);
        identities.set(
          identity,
          existing === undefined || existing === activityType ? activityType : null,
        );
      }
    }
  }
  return identities;
})();

const NETWORK_EXECUTABLES = new Set([
  "aria2c",
  "curl",
  "http",
  "httpie",
  "invoke-restmethod",
  "invoke-webrequest",
  "wget",
]);
const DATABASE_EXECUTABLES = new Set([
  "duckdb",
  "mariadb",
  "mongo",
  "mongosh",
  "mysql",
  "psql",
  "redis-cli",
  "sqlite3",
  "sqlcmd",
]);
const BUILD_EXECUTABLES = new Set([
  "cmake",
  "esbuild",
  "gmake",
  "make",
  "msbuild",
  "ninja",
  "rollup",
  "swc",
  "tsc",
  "webpack",
  "xbuild",
  "xcodebuild",
]);
const BUILD_RUNNERS = new Set(["bun", "npm", "pnpm", "yarn"]);
const GIT_NETWORK_SUBCOMMANDS = new Set(["clone", "fetch", "ls-remote", "pull", "push"]);
const MAVEN_BUILD_GOALS = new Set(["compile", "install", "package", "verify"]);
const DIRECT_BUILD_TOOLS = new Set([
  "cmake",
  "esbuild",
  "gmake",
  "make",
  "msbuild",
  "ninja",
  "rollup",
  "swc",
  "tsc",
  "webpack",
  "xbuild",
  "xcodebuild",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029)
    ) {
      return true;
    }
  }
  return false;
}

function boundedString(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > limit || hasControlCharacter(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function normalizeStructuredIdentity(value: unknown): string | undefined {
  const bounded = boundedString(value, MAX_STRUCTURED_IDENTITY_LENGTH);
  if (!bounded || !/^[a-z0-9 .:_-]+$/iu.test(bounded)) {
    return undefined;
  }
  const normalized = bounded
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .replace(/[ .:_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized.length > 0 ? normalized : undefined;
}

function classifyServerTool(
  serverValue: unknown,
  toolValue: unknown,
): MatrixActivityType | undefined {
  const server = normalizeStructuredIdentity(serverValue);
  const tool = normalizeStructuredIdentity(toolValue);
  if (!server || !tool) {
    return undefined;
  }
  for (const activityType of ["network", "database", "build"] as const) {
    const allowlist = SERVER_TOOL_IDENTITIES[activityType];
    if (allowlist.servers.has(server) && allowlist.tools.has(tool)) {
      return activityType;
    }
  }
  return undefined;
}

function classifyCompositeMcpIdentity(value: unknown): MatrixActivityType | undefined {
  const bounded = boundedString(value, MAX_STRUCTURED_IDENTITY_LENGTH);
  if (!bounded) {
    return undefined;
  }
  const segments = bounded.split("__");
  if (segments.length !== 3 || segments[0]?.toLowerCase() !== "mcp") {
    return undefined;
  }
  return classifyServerTool(segments[1], segments[2]);
}

function classifyOpenCodeCombinedMcpIdentity(value: unknown): MatrixActivityType | undefined {
  const bounded = boundedString(value, MAX_STRUCTURED_IDENTITY_LENGTH);
  if (!bounded || !/^[a-z0-9_-]+$/iu.test(bounded)) {
    return undefined;
  }
  return OPENCODE_COMBINED_MCP_IDENTITIES.get(bounded.toLowerCase()) ?? undefined;
}

function classifyOpenCodeToolIdentity(value: unknown): MatrixActivityType | undefined {
  const bounded = boundedString(value, MAX_STRUCTURED_IDENTITY_LENGTH);
  if (!bounded || !/^[a-z0-9_-]+$/iu.test(bounded)) {
    return undefined;
  }
  return (
    classifyOpenCodeCombinedMcpIdentity(bounded) ??
    STANDALONE_TOOL_IDENTITIES.get(bounded.toLowerCase())
  );
}

function classifyStandaloneToolIdentity(value: unknown): MatrixActivityType | undefined {
  return (
    classifyCompositeMcpIdentity(value) ??
    classifyOpenCodeCombinedMcpIdentity(value) ??
    STANDALONE_TOOL_IDENTITIES.get(normalizeStructuredIdentity(value) ?? "")
  );
}

function uniqueClassification(
  classifications: ReadonlyArray<MatrixActivityType | undefined>,
): MatrixActivityType | undefined {
  let selected: MatrixActivityType | undefined;
  for (const classification of classifications) {
    if (!classification) {
      continue;
    }
    if (selected && selected !== classification) {
      return undefined;
    }
    selected = classification;
  }
  return selected;
}

function classifyStructuredToolData(
  data: unknown,
  itemType: "mcp_tool_call" | "dynamic_tool_call",
): MatrixActivityType | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const item = isRecord(data.item) ? data.item : undefined;
  const classifications: MatrixActivityType[] = [];

  const addServerTool = (server: unknown, tool: unknown): boolean => {
    if (server === undefined && tool === undefined) {
      return true;
    }
    if (server === undefined || tool === undefined) {
      return false;
    }
    const classification = classifyServerTool(server, tool);
    if (!classification) {
      return false;
    }
    classifications.push(classification);
    return true;
  };
  const addStandaloneTool = (value: unknown): boolean => {
    if (value === undefined) {
      return true;
    }
    const classification = classifyStandaloneToolIdentity(value);
    if (!classification) {
      return false;
    }
    classifications.push(classification);
    return true;
  };
  const addOpenCodeTool = (value: unknown): boolean => {
    if (value === undefined) {
      return true;
    }
    const classification =
      itemType === "mcp_tool_call"
        ? classifyOpenCodeCombinedMcpIdentity(value)
        : classifyOpenCodeToolIdentity(value);
    if (!classification) {
      return false;
    }
    classifications.push(classification);
    return true;
  };

  if (!addServerTool(data.server, data.server === undefined ? undefined : data.tool)) {
    return undefined;
  }
  if (!addServerTool(item?.server, item?.server === undefined ? undefined : item?.tool)) {
    return undefined;
  }
  if (!addStandaloneTool(data.toolName)) {
    return undefined;
  }

  if (data.server === undefined && data.tool !== undefined) {
    if (!addOpenCodeTool(data.tool)) {
      return undefined;
    }
  }
  if (item?.server === undefined && item?.tool !== undefined) {
    if (itemType === "mcp_tool_call" || !addStandaloneTool(item.tool)) {
      return undefined;
    }
  }
  return uniqueClassification(classifications);
}

function classifyExactWebSearchData(data: unknown): MatrixActivityType | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const item = isRecord(data.item) ? data.item : undefined;
  const candidates = [item?.type, data.toolName, data.tool].filter(
    (candidate) => candidate !== undefined,
  );
  if (candidates.length === 0) {
    return undefined;
  }
  for (const candidate of candidates) {
    const identity = normalizeStructuredIdentity(candidate);
    if (
      !identity ||
      (!EXACT_WEB_TOOL_IDENTITIES.has(identity) &&
        classifyOpenCodeCombinedMcpIdentity(candidate) !== "network")
    ) {
      return undefined;
    }
  }
  return "network";
}

function commandTokens(command: string, maximumTokens: number): ReadonlyArray<string> | undefined {
  if (
    command.length === 0 ||
    command.length > MAX_COMMAND_LENGTH ||
    maximumTokens < 1 ||
    maximumTokens > MAX_COMMAND_TOKENS ||
    hasControlCharacter(command)
  ) {
    return undefined;
  }

  const tokens: string[] = [];
  let offset = 0;
  while (offset < command.length && tokens.length < maximumTokens) {
    while (offset < command.length && /\s/u.test(command[offset] ?? "")) {
      offset += 1;
    }
    if (offset >= command.length) {
      break;
    }

    let token = "";
    let quote: "'" | '"' | undefined;
    while (offset < command.length) {
      const character = command[offset] ?? "";
      if (quote) {
        if (character === quote) {
          quote = undefined;
        } else {
          token += character;
        }
        offset += 1;
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
        offset += 1;
        continue;
      }
      if (/\s/u.test(character)) {
        break;
      }
      token += character;
      offset += 1;
      if (token.length > MAX_COMMAND_TOKEN_LENGTH) {
        return undefined;
      }
    }
    if (quote || token.length === 0) {
      return undefined;
    }
    tokens.push(token);
  }
  return tokens.length > 0 ? tokens : undefined;
}

function executableName(token: string | undefined): string | undefined {
  if (!token || token.includes("://")) {
    return undefined;
  }
  const basename = token.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
  if (!basename) {
    return undefined;
  }
  const normalized = basename.replace(/\.(?:bat|cmd|com|exe)$/u, "");
  return /^[a-z0-9][a-z0-9._-]*$/u.test(normalized) ? normalized : undefined;
}

/**
 * Windows provider command execution wraps one command in a quoted PowerShell
 * `-Command` argument. Classify the bounded inner invocation without treating
 * arbitrary shell text as evidence. Anything with additional shell flags,
 * command chaining, interpolation/control syntax, ambiguous quoting, or
 * trailing arguments fails closed.
 */
function unwrapCanonicalWindowsPowerShellCommand(command: string): string | undefined {
  const match = /^(?:"([^"\r\n]+)"|([^ "'\r\n]+)) +(-command) +(["'])(.*)\4$/iu.exec(command);
  if (!match) {
    return undefined;
  }

  const executable = (match[1] ?? match[2])?.replaceAll("\\", "/").split("/").at(-1);
  if (!executable || !WINDOWS_POWERSHELL_EXECUTABLES.has(executable.toLowerCase())) {
    return undefined;
  }

  const wrapperQuote = match[4];
  const inner = boundedString(match[5], MAX_COMMAND_LENGTH);
  if (!wrapperQuote || !inner || inner !== match[5] || inner.includes(wrapperQuote)) {
    return undefined;
  }

  const prefixedCommand = inner.startsWith(WINDOWS_POWERSHELL_HEADLESS_NULL_PIPE_PREFIX)
    ? inner.slice(WINDOWS_POWERSHELL_HEADLESS_NULL_PIPE_PREFIX.length)
    : inner;
  const classifiedInner = boundedString(prefixedCommand, MAX_COMMAND_LENGTH);
  if (!classifiedInner || classifiedInner !== prefixedCommand) {
    return undefined;
  }
  // A bare quoted value is a PowerShell string expression, not an executable
  // invocation. Executing a quoted path would require the already-rejected
  // call operator (`&`).
  if (classifiedInner.startsWith("'") || classifiedInner.startsWith('"')) {
    return undefined;
  }

  let nestedQuote: "'" | '"' | undefined;
  for (let index = 0; index < classifiedInner.length; index += 1) {
    const character = classifiedInner[index] ?? "";
    if (nestedQuote) {
      if (character === nestedQuote) {
        nestedQuote = undefined;
      } else if (
        character === "`" ||
        (nestedQuote === '"' && (character === "$" || character === "@"))
      ) {
        return undefined;
      }
      continue;
    }

    if (character === "@" && (index === 0 || /\s/u.test(classifiedInner[index - 1] ?? ""))) {
      let tokenEnd = index + 1;
      while (tokenEnd < classifiedInner.length && !/\s/u.test(classifiedInner[tokenEnd] ?? "")) {
        tokenEnd += 1;
      }
      if (!SAFE_UNQUOTED_NPM_SCOPE_TOKEN.test(classifiedInner.slice(index, tokenEnd))) {
        return undefined;
      }
    }
    if (character === "'" || character === '"') {
      nestedQuote = character;
      continue;
    }
    if (
      character === ";" ||
      character === "|" ||
      character === "&" ||
      character === "`" ||
      character === "#" ||
      character === "<" ||
      character === ">" ||
      character === "{" ||
      character === "}" ||
      character === "$" ||
      character === "(" ||
      character === ")" ||
      (character === "@" && classifiedInner[index + 1] === "(")
    ) {
      return undefined;
    }
  }
  return nestedQuote === undefined ? classifiedInner : undefined;
}

function normalizedArgument(token: string | undefined): string | undefined {
  if (!token || token.length > MAX_COMMAND_TOKEN_LENGTH) {
    return undefined;
  }
  const normalized = token.toLowerCase();
  return /^[a-z0-9][a-z0-9:_-]*$/u.test(normalized) ? normalized : undefined;
}

function isBuildScriptName(token: string | undefined): boolean {
  if (!token || token.length > MAX_COMMAND_TOKEN_LENGTH) {
    return false;
  }
  const normalized = token.toLowerCase();
  return (
    normalized === "typecheck" ||
    /^(?:build|bundle|compile)(?::[a-z0-9][a-z0-9:_-]*)?$/u.test(normalized)
  );
}

function classifyBuildRunner(tokens: ReadonlyArray<string>): MatrixActivityType | undefined {
  const runner = executableName(tokens[0]);
  if (!runner || !BUILD_RUNNERS.has(runner)) {
    return undefined;
  }
  const first = normalizedArgument(tokens[1]);
  if (first === "workspace") {
    const workspaceName = boundedString(tokens[2], MAX_COMMAND_TOKEN_LENGTH);
    return workspaceName && isBuildScriptName(tokens[3]) ? "build" : undefined;
  }
  const script = first === "run" ? tokens[2] : tokens[1];
  return isBuildScriptName(script) ? "build" : undefined;
}

function classifyBuildToolRunner(tokens: ReadonlyArray<string>): MatrixActivityType | undefined {
  const runner = executableName(tokens[0]);
  if (runner !== "npx" && runner !== "bunx") {
    return undefined;
  }
  const tool = executableName(tokens[1]);
  if (!tool) {
    return undefined;
  }
  if (DIRECT_BUILD_TOOLS.has(tool)) {
    return "build";
  }
  return tool === "vite" && normalizedArgument(tokens[2]) === "build" ? "build" : undefined;
}

function classifyCommand(command: string): MatrixActivityType | undefined {
  const classifiedCommand = unwrapCanonicalWindowsPowerShellCommand(command) ?? command;
  const firstToken = commandTokens(classifiedCommand, 1);
  const executable = executableName(firstToken?.[0]);
  if (!executable) {
    return undefined;
  }
  if (NETWORK_EXECUTABLES.has(executable)) {
    return "network";
  }
  if (DATABASE_EXECUTABLES.has(executable)) {
    return "database";
  }
  if (BUILD_EXECUTABLES.has(executable)) {
    return "build";
  }

  const tokens = commandTokens(classifiedCommand, MAX_COMMAND_TOKENS);
  if (!tokens) {
    return undefined;
  }
  const subcommand = normalizedArgument(tokens[1]);
  if (executable === "git" && subcommand && GIT_NETWORK_SUBCOMMANDS.has(subcommand)) {
    return "network";
  }
  if (executable === "docker") {
    if (
      subcommand === "build" ||
      (subcommand === "buildx" && normalizedArgument(tokens[2]) === "build")
    ) {
      return "build";
    }
    if (subcommand === "pull" || subcommand === "push") {
      return "network";
    }
    return undefined;
  }
  if (executable === "cargo") {
    return subcommand === "build" || subcommand === "check" ? "build" : undefined;
  }
  if (executable === "go") {
    return subcommand === "build" ? "build" : undefined;
  }
  if (executable === "dotnet") {
    return subcommand === "build" || subcommand === "publish" ? "build" : undefined;
  }
  if (executable === "swift") {
    return subcommand === "build" ? "build" : undefined;
  }
  if (executable === "vite") {
    return subcommand === "build" ? "build" : undefined;
  }
  if (executable === "meson") {
    return subcommand === "compile" ? "build" : undefined;
  }
  if (executable === "gradle" || executable === "gradlew") {
    return subcommand === "assemble" || subcommand === "build" || subcommand === "classes"
      ? "build"
      : undefined;
  }
  if (executable === "mvn" || executable === "mvnw") {
    return subcommand && MAVEN_BUILD_GOALS.has(subcommand.replace(/^.*:/u, ""))
      ? "build"
      : undefined;
  }
  if (executable === "python" || executable === "python3" || executable === "py") {
    return tokens[1]?.toLowerCase() === "-m" && normalizedArgument(tokens[2]) === "build"
      ? "build"
      : undefined;
  }
  const runnerClassification = classifyBuildRunner(tokens) ?? classifyBuildToolRunner(tokens);
  if (runnerClassification) {
    return runnerClassification;
  }
  if (executable !== "corepack") {
    return undefined;
  }
  return classifyBuildRunner(tokens.slice(1)) ?? classifyBuildToolRunner(tokens.slice(1));
}

function commandFromSanitizedData(data: unknown): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const item = isRecord(data.item) ? data.item : undefined;
  const input = isRecord(data.input) ? data.input : undefined;
  const state = isRecord(data.state) ? data.state : undefined;
  const stateInput = isRecord(state?.input) ? state.input : undefined;
  const candidates = [data.command, item?.command, input?.command, stateInput?.command];
  const presentCandidates = candidates.filter((candidate) => candidate !== undefined);
  const commands = presentCandidates.map((candidate) =>
    boundedString(candidate, MAX_COMMAND_LENGTH),
  );
  if (commands.some((command) => command === undefined)) {
    return undefined;
  }
  const boundedCommands = commands.filter((command): command is string => command !== undefined);
  if (boundedCommands.length === 0) {
    return undefined;
  }
  const first = boundedCommands[0];
  return boundedCommands.every((command) => command === first) ? first : undefined;
}

/**
 * Projects only bounded, provider-observed activity categories. The returned
 * object contains no provider payload data and unknown or conflicting evidence
 * fails closed.
 */
export function classifyMatrixActivityObservation(
  input: MatrixActivityObservationInput,
): MatrixActivityObservation | undefined {
  if (input.itemType === "collab_agent_tool_call") {
    return OBSERVATIONS.agent;
  }
  if (input.itemType === "web_search") {
    return classifyExactWebSearchData(input.data) ? OBSERVATIONS.network : undefined;
  }

  let activityType: MatrixActivityType | undefined;
  if (input.itemType === "command_execution") {
    const command = commandFromSanitizedData(input.data);
    activityType = command ? classifyCommand(command) : undefined;
  } else if (input.itemType === "mcp_tool_call" || input.itemType === "dynamic_tool_call") {
    activityType = classifyStructuredToolData(input.data, input.itemType);
  }
  return activityType ? OBSERVATIONS[activityType] : undefined;
}
