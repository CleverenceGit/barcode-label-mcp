# Cleverence Label MCP server

Design, check and render barcode labels in [Cleverence Label](https://www.cleverence.com/label)
from your AI agent.

npm package: [`@cleverence/barcode-label-mcp`](https://www.npmjs.com/package/@cleverence/barcode-label-mcp)

Cleverence Label is a browser app for designing and printing barcode labels. This MCP server lets
the AI agent you already use, such as Claude, Cursor or GitHub Copilot, work in Cleverence Label
for you.

## What the agent can do

You describe the label: a 4×6 shipping label, a warehouse bin tag, a UPC price sticker, or an
asset tag with a QR code. The agent reads the published label design schema and writes the label
design as JSON.

Then the agent calls `validate_design`. This tool recomputes UPC, EAN and ITF-14 check digits. It
test-renders every barcode to confirm that a scanner could read it. It also moves elements that
fall outside the label back inside, and it matches data fields to the elements that use them.

The agent saves the corrected label design to your Cleverence Label library. After that, the
agent can render the label design to PDF, PNG or SVG, or get embed code for a web page.

The agent can also work with label scripts. A label script is either a generator form that turns
a few inputs into many labels (for example, bin locations from a warehouse layout), or a scan
station that fills and prints a label for each barcode scanned. The agent can dry-run a label
script before it saves the label script.

If your organization has PrintHub installed on a computer with a label printer, the agent can
also list those printers, print a saved label design on one of them, and check whether the print
job finished.

## What it costs

- Writing and validating a label design runs on your agent's tokens. It does not use the
  Cleverence AI generation allowance on any plan, including Free.
- Each render uses one label from the monthly label allowance, the same as printing from the app.
- Each label printed on a printer also uses one label from the allowance.
- Adding or changing a label script needs the Professional plan or higher.
- Printing on a printer needs the Professional plan or higher for the organization's owner.

See [pricing](https://www.cleverence.com/label/pricing) for the plans.

## Requirements

- Node.js 20 or later.
- A Cleverence Label account. You can create a free account during the first connection.

## Install

You don't need an API key to install the server.

### Claude Code

```bash
claude mcp add cleverence-label -- npx -y @cleverence/barcode-label-mcp
```

### Claude Desktop, Cursor, Windsurf, Cline

In Claude Desktop, open Settings > Developer > Edit Config. In Cursor, edit `~/.cursor/mcp.json`.
Add this server:

```json
{
  "mcpServers": {
    "cleverence-label": {
      "command": "npx",
      "args": ["-y", "@cleverence/barcode-label-mcp"]
    }
  }
}
```

### GitHub Copilot in VS Code

Create `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "cleverence-label": {
      "command": "npx",
      "args": ["-y", "@cleverence/barcode-label-mcp"]
    }
  }
}
```

## Connect your Cleverence Label account

1. Ask your agent for a label. If the agent has no API key yet, the first tool call returns an
   approval link. You can also ask the agent to call the `connect` tool before you start.
2. Open the link, then sign in or create a free Cleverence Label account.
3. Click "Connect".
4. The agent calls `finish_connecting`. The server saves the agent's API key to
   `~/.cleverence/credentials.json` on your computer, so you connect only once.

To revoke the API key and delete the saved copy, ask the agent to call `disconnect`.

### Use an API key you already have (optional)

The server looks for an API key in this order and uses the first one it finds:

1. The `--key` command-line option.
2. The `CLEVERENCE_LABEL_DESIGN_KEY` environment variable.
3. The file `~/.cleverence/credentials.json`, which `connect` writes.

A key created in the app under Settings > API Keys is a printing key. A printing key can render
and print, but it cannot read or change label designs. If you want the agent to design labels,
use the `connect` flow above.

```json
{
  "mcpServers": {
    "cleverence-label": {
      "command": "npx",
      "args": ["-y", "@cleverence/barcode-label-mcp"],
      "env": { "CLEVERENCE_LABEL_DESIGN_KEY": "cl_live_..." }
    }
  }
}
```

| Environment variable | Required | Description |
|---|---|---|
| `CLEVERENCE_LABEL_DESIGN_KEY` | No | Cleverence Label API key. If it is not set, the `connect` tool gets a key through a browser approval link. |
| `CLEVERENCE_CONFIG_DIR` | No | Folder for the saved credentials file. Default: `~/.cleverence`. |

### HTTP mode

By default the server talks to the agent over stdio. To run it as a Streamable HTTP server on
your own machine, start it like this:

```bash
npx -y @cleverence/barcode-label-mcp --http --port 3001
```

In HTTP mode, the MCP client sends the API key in the `Authorization: Bearer <key>` header.
Cleverence does not host a public MCP endpoint.

Command-line options:

```
--key, -k       Cleverence Label API key (optional)
--http          Use HTTP transport instead of stdio
--port, -p      HTTP port (default: 3001, or the MCP_PORT environment variable)
--base-url      Override the API base URL (default: https://label.cleverence.com)
--help, -h      Show help
```

## Tools

| Tool | What it does | Changes data? |
|---|---|---|
| `connect` | Returns an approval link that gets this agent its own API key | Starts a sign-in request |
| `finish_connecting` | Collects the API key after you approve the link, and saves it on your computer | Saves a local file |
| `connection_status` | Says whether the agent has an API key and where the key came from | No |
| `disconnect` | Revokes the API key in use and deletes the saved copy | Yes, cannot be undone |
| `list_api_keys` | Lists the account's API keys, never the keys themselves (needs the `keys:manage` scope) | No |
| `whoami` | Checks the API key and returns the account, plan, scopes and remaining allowance | No |
| `invite_user` | Sends an email that invites a person to create a Cleverence Label account | Sends an email |
| `get_design_schema` | Returns the JSON Schema for a label design | No |
| `validate_design` | Checks and repairs a label design the agent wrote; saves nothing | No |
| `create_design_from_json` | Saves a label design the agent wrote | Creates a label design |
| `update_design_content` | Replaces the elements, data fields or label script of a label design, as a new version | Yes, earlier versions are kept |
| `list_designs` | Lists the label designs in your library | No |
| `create_design` | Creates an empty label design or one from a gallery template | Creates a label design |
| `get_design` | Returns a label design with its elements and data fields | No |
| `update_design` | Changes a label design's name, description, visibility or folder | Yes |
| `delete_design` | Moves a label design to deleted; it can be restored | Yes |
| `list_templates` | Lists the gallery templates | No |
| `get_embed_code` | Returns iframe or HTML code to embed a label design in a web page | No |
| `get_thumbnail` | Returns the SVG thumbnail URL of a label design | No |
| `render_design` | Returns a URL that renders a label design to PDF, PNG, SVG or HTML; each fetch of the URL uses one label | No |
| `get_snippets` | Returns code snippets for adding Cleverence Label to a web app | No |
| `get_script_reference` | Returns the label script guide and the built-in function reference | No |
| `preview_script_rows` | Dry-runs a label script generator and shows the first rows | No |
| `simulate_scans` | Dry-runs a label script scan station with a list of barcodes | No |
| `list_printers` | Lists the label printers PrintHub found for the organization | No |
| `print_to_printer` | Prints a saved label design on a printer through PrintHub | Prints labels |
| `get_print_job` | Says whether a print job finished | No |

Every tool declares MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`), so the MCP client can ask you before the agent runs a tool that changes data.

## Resources

| Resource | Content |
|---|---|
| `cleverence://schema/label-design` | The label design JSON Schema |
| `cleverence://skills/design-a-label` | How to write a label design: layout, barcodes, data fields |
| `cleverence://skills/label-scripts` | How to write label scripts: generators and scan stations |
| `cleverence://skills/label-scripts-builtins` | The built-in functions of label scripts |
| `cleverence://skills/new-label-customer` | A company owns its label designs; a supplier prints them |
| `cleverence://skills/partner-label-platform` | Organizations per customer, handover, management keys |
| `cleverence://pricing` | Plans, features and limits |
| `cleverence://templates` | The gallery templates |
| `cleverence://docs` | Integration guide |

## Example prompts

- "Make a 4×6 shipping label with a Code 128 tracking barcode and a ship-to address, and save it
  to Cleverence Label."
- "Design a 2×1 inch UPC price label for SKU 012345678905 and check that the barcode scans."
- "Create bin location labels for aisles A to C, racks 1 to 10, with a QR code on each."
- "Render my 'Asset tag' label design as a PDF."

## Privacy

The server sends your label designs and requests to the Cleverence Label API at
`https://label.cleverence.com`. The server saves the API key only on your computer, in
`~/.cleverence/credentials.json`. See the [privacy policy](https://label.cleverence.com/privacy).

## Build from source

```bash
npm ci
npm run build
npm test
node dist/index.js --help
```

## Links

- [Cleverence Label](https://www.cleverence.com/label)
- [Using Cleverence Label with AI agents](https://www.cleverence.com/label/ai-agents)
- [Machine-readable description](https://label.cleverence.com/.well-known/mcp.json)
- [API reference (OpenAPI)](https://label.cleverence.com/openapi.json)

## License

MIT. See [LICENSE](LICENSE).
