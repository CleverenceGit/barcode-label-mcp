import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const DOCS_TEXT = `# Cleverence Label Integration Guide

Cleverence Label is a cloud-hosted barcode label design and printing platform.
Integrate it into web apps via iframes, direct links, and the REST API.
There is no npm package to install — everything is hosted.

## Quick Start

1. Sign up: https://label.cleverence.com/auth/signup
2. Create an API key: https://label.cleverence.com/app?panel=settings
3. Save the key as CLEVERENCE_LABEL_DESIGN_KEY in your environment
4. Use the API or this MCP server to manage designs

## Embedding (no package needed)

iframe:
  <iframe src="https://label.cleverence.com/e/{designId}" width="360" height="270" frameborder="0"></iframe>

Thumbnail:
  <img src="https://label.cleverence.com/api/thumbnails/{designId}" alt="Label preview" />

Direct links:
  Designer: https://label.cleverence.com/d/{designId}
  Viewer: https://label.cleverence.com/t/{designId}

## API Authentication

All /api/v1/* endpoints require the x-api-key header (except /api/v1/auth/invite).

  x-api-key: cl_live_...

## Authoring designs yourself

You can write the design JSON. Cleverence validates, stores, renders and prints
it. No Cleverence AI runs on that path, so it consumes no AI generation quota
and works on every plan including Free.

  1. get_design_schema (or read cleverence://skills/design-a-label)
  2. validate_design    — recomputes barcode check digits, test-renders every
                          barcode, clamps out-of-bounds elements, reconciles
                          data fields; saves nothing; free
  3. create_design_from_json with the corrected design; free
  4. render_design      — look at the result; consumes one label
  5. update_design_content to iterate; each save appends a revertible version

Authoring and validating are unmetered because they run on your tokens.
Rendering is Cleverence's compute, so each render draws one label from the
monthly allowance, the same as printing from the app. Validate until clean,
then render once — do not render to check your work. whoami reports how much
of the allowance is left.

Label scripts: a design can carry a generator (location labels from a
warehouse layout, asset IDs, unique QR codes) or a scan station. Read
cleverence://skills/label-scripts, write the scripts block, validate_design,
then preview_script_rows or simulate_scans, then update_design_content.
Adding or changing a script needs Professional or higher; running it is free.

All sizes and coordinates are in millimetres, origin at the top-left.

## Available Tools

This MCP server provides:
- whoami — validate API key, get account info, tier, scopes and allowance
- invite_user — send invitation email (does not create an account)
- get_design_schema — the JSON Schema for a label design
- validate_design — check and auto-fix a design you authored
- create_design_from_json — save an authored design
- update_design_content — replace elements/data fields and/or the label script, appends a version
- get_script_reference — the label script skill and builtin reference
- preview_script_rows — dry-run a label script generator: first rows, count, quality checks; free
- simulate_scans — dry-run a label script scan station with a list of barcodes; free
- list_designs, create_design, get_design, update_design, delete_design
- list_templates — browse gallery templates
- get_embed_code — get iframe/HTML embed snippet
- get_thumbnail — get SVG thumbnail URL
- render_design — render to PDF/PNG/SVG/HTML
- get_snippets — get integration code snippets
- list_printers — the label printers PrintHub found: code, name, site, online or offline
- print_to_printer — print a saved design on a printer; needs PrintHub and Professional or higher; each label counts
- get_print_job — whether a print job printed: Pending, Dispatched, Succeeded, Failed, Cancelled, Expired

## Resources

- cleverence://skills/design-a-label — how to author a label design
- cleverence://skills/new-label-customer — a company owns its labels; a supplier prints and cannot change them
- cleverence://skills/partner-label-platform — organizations per customer, handover, management key, printing keys
- cleverence://skills/label-scripts — label scripts: generators (location, asset ID, unique-code labels) and scan stations
- cleverence://schema/label-design — the design JSON Schema
- cleverence://templates — the live gallery
- cleverence://pricing — plans and limits
- cleverence://docs — this guide

## Full Documentation

- Design schema: https://label.cleverence.com/schema/label-design.v2.json (v1 documents remain valid)
- Design skill: https://label.cleverence.com/skills/design-a-label.md
- New customer skill: https://label.cleverence.com/skills/new-label-customer.md
- Partner skill: https://label.cleverence.com/skills/partner-label-platform.md
- Label scripts skill: https://label.cleverence.com/skills/label-scripts.md
- OpenAPI spec: https://label.cleverence.com/openapi.json
- Full text docs: https://label.cleverence.com/llms-full.txt
- Pricing: https://label.cleverence.com/pricing.md`;

export function addDocsResource(server: McpServer) {
  server.registerResource(
    'docs',
    'cleverence://docs',
    {
      title: 'Integration Guide',
      description: 'How to integrate Cleverence Label into a web app',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: DOCS_TEXT }],
    }),
  );
}
