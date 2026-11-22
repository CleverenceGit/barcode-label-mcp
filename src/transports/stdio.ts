import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../server.js';

export async function runStdio(apiKey: string | null, baseUrl?: string): Promise<void> {
  const server = createMcpServer(apiKey, baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr, never stdout: stdout carries the MCP protocol.
  console.error(
    apiKey
      ? 'Cleverence Label MCP server running on stdio'
      : 'Cleverence Label MCP server running on stdio (no API key — use the connect tool)',
  );
}
