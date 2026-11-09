// Local MCP server so Claude Code can work on the open project (AI_ARCHITECTURE.md §7).
//
// - Listens on 127.0.0.1 only, off by default; the owner turns it on in Settings.
// - Every request needs the bearer token from Settings (compared in constant time).
// - Requests carrying a browser Origin header, or a Host other than this server, are refused,
//   so web pages cannot reach it (DNS rebinding).
// - Tools are answered by the window (src/renderer/ai), where the project and the approval
//   panel live. Change tools only create proposals the owner must approve there.

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpStatus } from "../shared/ipc";

export interface ToolBridge {
  specs(): Promise<{ name: string; description: string; inputSchema: Record<string, unknown> }[]>;
  call(name: string, params: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
}

const MAX_BODY = 4 * 1024 * 1024;
const INSTRUCTIONS = [
  "To make an object, design it from several parts with realistic mm sizes and build it with one cad_build call (not a single box).",
  "You are connected to MakerStudio AI, the owner's CAD, circuit, display and robotics app.",
  "Read tools (get_project, check_circuit, list_catalog) show the open project. Sizes are millimetres.",
  "Change tools only PROPOSE changes: the owner reviews them in MakerStudio's AI panel and must approve them. Never say a change was made until the owner approves it.",
  "Use list_catalog for part and board specs instead of your own memory, and say 'unknown' when a spec is missing.",
  "Never call a circuit or design safe: report the checks' findings as they are.",
].join("\n");

let http: HttpServer | null = null;
let state: McpStatus = { running: false, port: 0, url: "", error: null, calls: 0 };

export function mcpStatus(): McpStatus {
  return { ...state };
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from((header ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(token);
  return token.length >= 32 && given.length === want.length && timingSafeEqual(given, want);
}

function refuse(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("Request too large.");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}

function mcpServer(bridge: ToolBridge): Server {
  const server = new Server({ name: "makerstudio", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await bridge.specs() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    state.calls++;
    const result = await bridge.call(request.params.name, request.params.arguments ?? {});
    return result.ok
      ? { content: [{ type: "text", text: JSON.stringify(result.data, null, 1) }] }
      : { content: [{ type: "text", text: result.error }], isError: true };
  });
  return server;
}

export async function startMcp(port: number, token: string, bridge: ToolBridge): Promise<McpStatus> {
  await stopMcp();
  const url = `http://127.0.0.1:${port}/mcp`;
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  http = createServer((req, res) => {
    void (async () => {
      if ((req.url ?? "").split("?")[0] !== "/mcp") return refuse(res, 404, "Not found.");
      if (req.headers.origin) return refuse(res, 403, "Browser requests are not allowed.");
      if (!allowedHosts.has(String(req.headers.host ?? ""))) return refuse(res, 403, "Wrong host.");
      if (!tokenMatches(req.headers.authorization, token)) return refuse(res, 401, "Missing or wrong token.");
      try {
        // Stateless: a fresh server and transport per request.
        const body = req.method === "POST" ? await readBody(req) : undefined;
        const server = mcpServer(bridge);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (error) {
        if (!res.headersSent) refuse(res, 400, error instanceof Error ? error.message : String(error));
      }
    })();
  });
  await new Promise<void>((resolve) => {
    http!.once("error", (error: NodeJS.ErrnoException) => {
      state = { running: false, port, url, error: error.code === "EADDRINUSE" ? `Port ${port} is already in use: choose another port.` : error.message, calls: 0 };
      http = null;
      resolve();
    });
    http!.listen(port, "127.0.0.1", () => {
      state = { running: true, port, url, error: null, calls: 0 };
      resolve();
    });
  });
  return mcpStatus();
}

export async function stopMcp(): Promise<void> {
  if (!http) { state = { ...state, running: false }; return; }
  const h = http;
  http = null;
  await new Promise<void>((resolve) => h.close(() => resolve()));
  state = { ...state, running: false };
}
