import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDefinition } from "../../types.js";
import { translateMcpToolToHarness } from "./schema-translator.js";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpClientHandle {
  serverName: string;
  client: Client;
  tools: ToolDefinition[];
  callTool(
    name: string,
    input: unknown,
  ): Promise<{ output: string; isError: boolean }>;
  disconnect(): Promise<void>;
}

export async function connectMcpServer(
  serverName: string,
  config: McpServerConfig,
): Promise<McpClientHandle> {
  const client = new Client({ name: "claw-engine", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: config.env,
  });

  await client.connect(transport);

  const { tools: rawTools } = await client.listTools();
  const tools = (rawTools ?? []).map((t) =>
    translateMcpToolToHarness({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
    }),
  );

  return {
    serverName,
    client,
    tools,

    async callTool(name: string, input: unknown) {
      try {
        const result = await client.callTool({
          name,
          arguments: input as Record<string, unknown>,
        });
        const content = result.content ?? [];
        const text = (content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");
        const isError = result.isError === true;
        return { output: text, isError };
      } catch (err) {
        return {
          output: err instanceof Error ? err.message : String(err),
          isError: true,
        };
      }
    },

    async disconnect() {
      await client.close();
    },
  };
}

/** Manager that holds multiple MCP connections and filters tools per task. */
export class McpClientManager {
  private handles = new Map<string, McpClientHandle>();

  async connect(serverName: string, config: McpServerConfig): Promise<void> {
    const handle = await connectMcpServer(serverName, config);
    this.handles.set(serverName, handle);
  }

  getToolsForServers(serverNames: string[]): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const name of serverNames) {
      const handle = this.handles.get(name);
      if (handle) tools.push(...handle.tools);
    }
    return tools;
  }

  async callTool(
    toolName: string,
    input: unknown,
    serverNames: string[],
  ): Promise<{ output: string; isError: boolean }> {
    for (const name of serverNames) {
      const handle = this.handles.get(name);
      if (handle?.tools.some((t) => t.name === toolName)) {
        return handle.callTool(toolName, input);
      }
    }
    return {
      output: `MCP tool "${toolName}" not found in servers: ${serverNames.join(", ")}`,
      isError: true,
    };
  }

  async disconnectAll(): Promise<void> {
    for (const handle of this.handles.values()) {
      await handle.disconnect();
    }
    this.handles.clear();
  }
}
