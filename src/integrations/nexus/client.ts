import { connectMcpServer, type McpClientHandle } from "../mcp/mcp-client.js";

/**
 * Nexus client: connects to Nexus MCP server for workflow queries.
 */
export interface NexusWorkflow {
  intent: string;
  workflow: string;
  phases: Array<{
    phase: string;
    description: string;
    tools: string[];
  }>;
}

export async function connectNexusMcp({
  nexusMcpCommand = "/opt/homebrew/opt/node@22/bin/node",
  nexusMcpArgs = ["/Users/macmini/server/apps/nexus/server/dist/mcp-stdio.js"],
  env,
}: {
  nexusMcpCommand?: string;
  nexusMcpArgs?: string[];
  env?: Record<string, string>;
}): Promise<McpClientHandle | null> {
  try {
    const config = {
      command: nexusMcpCommand,
      args: nexusMcpArgs,
      env: env || {
        DATABASE_URL: "postgres://nexus:nexus_local@127.0.0.1:5432/nexus",
      },
    };

    const handle = await connectMcpServer("nexus", config);
    
    // Verify the connection by checking if we have the expected tools
    const hasNexusTools = handle.tools.some(
      tool => tool.name === "nexus" || tool.name === "nexus_save"
    );
    
    if (!hasNexusTools) {
      console.warn("[nexus] Connected but missing expected tools (nexus, nexus_save)");
      await handle.disconnect();
      return null;
    }
    
    return handle;
  } catch (error) {
    console.warn(`[nexus] Failed to connect to MCP server:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}
