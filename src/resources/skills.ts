import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CleverenceLabelApi } from '../lib/api.js';

/**
 * Exposes the published design schema and the agent skills (design-a-label,
 * label-scripts and its builtin reference, and the customer and partner
 * guides) as MCP resources.
 *
 * Agent Skills are a filesystem standard — the client loads SKILL.md from its
 * own skills directory, and nothing about that goes over MCP. Serving the same
 * text as a resource is the fallback for a client that is already connected
 * here and has not installed the skill: it can pull the guidance on demand
 * rather than guessing at the design format.
 */
export function addSchemaResource(server: McpServer, api: CleverenceLabelApi) {
  server.registerResource(
    'design-schema',
    'cleverence://schema/label-design',
    {
      title: 'Label Design JSON Schema',
      description:
        'The contract for a label design document. Read before authoring design JSON by hand.',
      mimeType: 'application/schema+json',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: await api.getDesignSchema() }],
    }),
  );
}

export function addSkillResource(server: McpServer, api: CleverenceLabelApi) {
  server.registerResource(
    'design-a-label',
    'cleverence://skills/design-a-label',
    {
      title: 'Skill: Design a Label',
      description:
        'How to author print-ready label designs as JSON: the schema, the layout algorithm, barcode selection and check digits, data fields, and worked examples. Authoring costs no Cleverence AI quota.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: await api.getSkill('design-a-label') }],
    }),
  );

  server.registerResource(
    'label-scripts',
    'cleverence://skills/label-scripts',
    {
      title: 'Skill: Label scripts',
      description:
        'How to write label scripts (CLS/1): a generator form that makes many label rows (location and aisle labels, asset IDs, unique QR codes) or a scan station that fills and prints a label per scan. Block shape, expressions, range specs, five examples, common mistakes, and the validate → preview → save loop. Authoring needs Professional; running is free.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: await api.getSkill('label-scripts') }],
    }),
  );

  server.registerResource(
    'label-scripts-builtins',
    'cleverence://skills/label-scripts-builtins',
    {
      title: 'Reference: Label script builtins',
      description:
        'Every builtin function a label script can call, with its signature, semantics and a tested example, plus the diagnostic codes and limits. Generated from the interpreter.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: await api.getSkill('label-scripts-builtins') }],
    }),
  );

  server.registerResource(
    'new-label-customer',
    'cleverence://skills/new-label-customer',
    {
      title: 'Skill: A new Label customer',
      description:
        'A company signs up and owns its labels. A supplier can print a shared label and cannot change it.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: await api.getSkill('new-label-customer') }],
    }),
  );

  server.registerResource(
    'partner-label-platform',
    'cleverence://skills/partner-label-platform',
    {
      title: 'Skill: Partner product',
      description:
        'Organizations per customer, handover, an unattached management key, and an org-wise management key that runs the management API inside one organization.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: await api.getSkill('partner-label-platform') }],
    }),
  );
}
