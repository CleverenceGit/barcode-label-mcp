export const HELP_TEXT = `
@cleverence/barcode-label-mcp — MCP server for Cleverence Label

Usage:
  barcode-label-mcp [options]

Options:
  --key, -k       Cleverence Label API key (optional — see Authentication)
  --http          Use HTTP transport instead of stdio (default: stdio)
  --port, -p      HTTP port (default: 3001, or MCP_PORT env var)
  --base-url      Override the API base URL (default: https://label.cleverence.com)
  --help, -h      Show this help message

Authentication:
  No key needed to start. Run the 'connect' tool and the server obtains its own
  key: it gives you a link, you approve in the browser, and the key is saved to
  ~/.cleverence/credentials.json.

  Key resolution order: --key, then CLEVERENCE_LABEL_DESIGN_KEY, then the saved
  credentials file. Set CLEVERENCE_CONFIG_DIR to move that file.
  CLEVERENCE_API_KEY, the name before 1.7, still works.

Stdio mode (default):
  npx @cleverence/barcode-label-mcp

HTTP mode:
  npx @cleverence/barcode-label-mcp --http --port 3001
  Clients pass API key via Authorization: Bearer <key> header.

Cursor config (~/.cursor/mcp.json):
  {
    "mcpServers": {
      "cleverence-label": {
        "command": "npx",
        "args": ["-y", "@cleverence/barcode-label-mcp"]
      }
    }
  }

Claude Code:
  claude mcp add cleverence-label -- npx -y @cleverence/barcode-label-mcp
`.trim();

export function printHelp(): void {
  console.log(HELP_TEXT);
}
