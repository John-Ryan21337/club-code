// @effect-diagnostics nodeBuiltinImport:off
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { query, type SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

describe("Claude SDK secure MCP initialization", () => {
  for (const accepted of [true, false]) {
    it(`keeps credentials off argv and requires CLI acknowledgement (${accepted})`, async () => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const events = new EventEmitter();
      let spawnOptions: SpawnOptions | undefined;
      let initializedServers: unknown;
      let promptSent = false;
      let pending = "";
      const servers = {
        club_browser: {
          type: "http" as const,
          url: "http://127.0.0.1:12345/mcp",
          headers: { Authorization: "Bearer test-only-capability" },
        },
      };
      stdin.on("data", (data: Buffer) => {
        pending += data.toString("utf8");
        let newline: number;
        while ((newline = pending.indexOf("\n")) !== -1) {
          const frame = JSON.parse(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          if (frame.type === "user") promptSent = true;
          if (frame.type === "control_request" && frame.request.subtype === "initialize") {
            initializedServers = frame.request.mcpServers;
            stdout.write(
              `${JSON.stringify({
                type: "control_response",
                response: {
                  subtype: "success",
                  request_id: frame.request_id,
                  response: {
                    commands: [],
                    models: [],
                    agents: [],
                    ...(accepted ? { mcp_servers_applied: true } : {}),
                  },
                },
              })}\n`,
            );
          }
        }
      });
      const session = query({
        prompt: "test prompt",
        options: {
          pathToClaudeCodeExecutable: "test-claude",
          mcpServersDelivery: "initialize",
          mcpServers: servers,
          spawnClaudeCodeProcess: (options) => {
            spawnOptions = options;
            return Object.assign(events, {
              stdin,
              stdout,
              killed: false,
              exitCode: null,
              kill: () => {
                stdout.end();
                events.emit("exit", 0, null);
                return true;
              },
            });
          },
        },
      });
      try {
        if (accepted) {
          expect((await session.initializationResult()).mcp_servers_applied).toBe(true);
        } else {
          await expect(session.initializationResult()).rejects.toThrow(/mcpServersDelivery/);
          expect(promptSent).toBe(false);
        }
        expect(initializedServers).toEqual(servers);
        expect(spawnOptions?.args.join(" ")).not.toContain("test-only-capability");
        expect(spawnOptions?.args).not.toContain("--mcp-config");
      } finally {
        session.close();
        stdin.destroy();
        stdout.destroy();
      }
    });
  }
});
