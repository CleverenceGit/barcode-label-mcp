import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CleverenceLabelApi, CLIENT_VERSION } from './lib/api.js';
import {
  addAuthTools,
  addAuthoringTools,
  addConnectTools,
  addDesignTools,
  addEmbedTools,
  addPrintingTools,
  addScriptTools,
  addTemplateTools,
} from './tools/index.js';
import {
  addPricingResource,
  addTemplatesResource,
  addDocsResource,
  addSchemaResource,
  addSkillResource,
} from './resources/index.js';

export function createMcpServer(apiKey: string | null, baseUrl?: string): McpServer {
  const server = new McpServer(
    {
      name: 'cleverence-label',
      version: CLIENT_VERSION,
    },
    {
      instructions:
        'Cleverence Label stores, validates, renders and prints barcode label designs.\n\n' +
        'To produce a label, prefer authoring the design JSON yourself: read the ' +
        'cleverence://skills/design-a-label resource (or call get_design_schema), build the ' +
        'document, call validate_design, then create_design_from_json with the corrected ' +
        'design. That path runs no Cleverence AI, so it consumes no generation quota and ' +
        'works on every plan including Free.\n\n' +
        'Call list_templates first if the user wants to start from a pre-built label. ' +
        'Use whoami to verify the API key and check remaining allowance. ' +
        'Use get_snippets for ready-to-paste embed code, and render_design to show the result. ' +
        'When the product prints for many customers, read cleverence://skills/partner-label-platform ' +
        'before creating organizations or queueing a printer.\n\n' +
        'To print on a label printer: list_printers for the printer code, get_design for the ' +
        'field names, then print_to_printer, then get_print_job to see whether it printed. ' +
        'This needs PrintHub installed where the printer is and a Professional or higher plan, ' +
        'and each label counts against the monthly allowance. Print only when the user asks, ' +
        'and never repeat a print or print in a loop without their say-so.\n\n' +
        'For location, asset ID, unique code or scan-to-print labels, read ' +
        'cleverence://skills/label-scripts, then validate_design, then preview_script_rows or ' +
        'simulate_scans, then save with update_design_content. Adding or changing a script needs ' +
        'Professional or higher; running it in the viewer is free on every plan.\n\n' +
        'Authorization: if a tool reports that you are not connected, it will hand you an ' +
        'approval link. Show that link to the user immediately and verbatim, then call ' +
        'finish_connecting and retry. Never ask the user for an API key, never tell them to ' +
        'visit a settings page, and do not stop at "you will need to approve a link" without ' +
        'producing one — the link is in the error you just received, or from the connect tool.',
    },
  );

  const api = new CleverenceLabelApi(apiKey, baseUrl);

  addConnectTools(server, api);
  addAuthTools(server, api);
  addAuthoringTools(server, api);
  addDesignTools(server, api);
  addEmbedTools(server, api);
  addTemplateTools(server, api);
  addScriptTools(server, api);
  addPrintingTools(server, api);

  addPricingResource(server);
  addTemplatesResource(server, api);
  addDocsResource(server);
  addSchemaResource(server, api);
  addSkillResource(server, api);

  return server;
}
