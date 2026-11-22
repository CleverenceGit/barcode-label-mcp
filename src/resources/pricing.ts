import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const PRICING_TEXT = `# Cleverence Label Pricing

| Plan | Price | Designs | Monthly Labels |
|------|-------|---------|----------------|
| Free | $0/mo | 2 | 50 |
| Starter | $19/mo | 5 | 500 |
| Professional | $39/mo | 15 | 10,000 |
| Enterprise | $99/mo | Unlimited | 1,000,000 |
| Partner | $159/mo | Unlimited | 1,000,000 |

All plans include: label designer, viewer, PDF/SVG export, thumbnail API, sharing & embed, printing API access.

Partner is Enterprise plus the management API and management keys, for a product that replaces Label's own screens. Same limits as Enterprise: 1,000,000 labels and 200 AI generations a month. A product that only prints needs Enterprise. Custom limits and features: sales@cleverence.com.

Starter adds: dynamic data fields, image elements, AI label design, Excel upload (10 rows).
Professional adds: custom fonts, formula elements, database connections, REST API data, webhooks, Excel upload (100 rows).
Enterprise adds: SSO/LDAP, audit logs, approval workflows, pre-built connectors, Excel upload (1000 rows).

| Feature | Free | Starter | Professional | Enterprise / Partner |
|---------|------|---------|--------------|----------------------|
| Label scripts (authoring generators and scan stations) | No | No | Yes | Yes |

Label scripts run free on every plan: anyone who can open a design can use its generator or scan station. Adding or changing a script needs Professional or higher. Validating and previewing scripts are unmetered. Printing to a printer through PrintHub still needs a plan with managed printing.

Annual billing saves ~17%. No credit card required for Free tier.

Sign up: https://label.cleverence.com/auth/signup
Full pricing: https://label.cleverence.com/plans`;

export function addPricingResource(server: McpServer) {
  server.registerResource(
    'pricing',
    'cleverence://pricing',
    {
      title: 'Cleverence Label Pricing',
      description: 'Plans, features, and limits for Cleverence Label',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: PRICING_TEXT }],
    }),
  );
}
