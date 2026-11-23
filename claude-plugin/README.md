# Cleverence Label for Claude

Design, check, render and print barcode labels in [Cleverence Label](https://www.cleverence.com/label)
by asking Claude.

Cleverence Label is a browser app for designing and printing barcode labels. This plugin connects
Claude to your Cleverence Label account. You describe the label, for example a 4×6 shipping label,
a warehouse bin tag, a UPC price sticker or an asset tag with a QR code. Claude writes the label
design, checks it, saves it to your label library and renders it to PDF, PNG or SVG.

## What Claude can do with it

- Write a label design from your description, following the published label design schema.
- Check a label design: recompute UPC, EAN and ITF-14 check digits, test that every barcode scans,
  and move elements that fall outside the label back inside.
- Save, list, change and render label designs in your label library.
- Start from a label template.
- Write and dry-run label scripts: generator forms that make many labels from a few inputs, and
  scan stations that print a label for each barcode scanned.
- Get embed code to show a label design on a web page.
- If your organization runs PrintHub on a computer with a label printer: list the printers, print
  a saved label design and check whether the print job finished.

## Install

In Claude Code, run:

```
/plugin install cleverence-label --marketplace CleverenceGit/barcode-label-mcp
```

## Connecting your account

You don't need an API key to install the plugin. The first time Claude needs your account, it
shows a link. Open the link, sign in to Cleverence Label (or create a free account) and approve
the connection. If you already have a Cleverence Label API key, you can paste it into the
plugin's "Cleverence Label API key (optional)" setting instead.

## What the plugin runs, sends and stores

- **Runs:** the open-source MCP server `@cleverence/barcode-label-mcp`, pinned to version 1.8.2,
  through `npx`. Its source code is in this repository. It needs Node.js 20 or later.
- **Sends:** requests to the Cleverence Label API at `https://label.cleverence.com` only. A request
  carries your API key and the data of the action Claude takes, such as a label design to check
  or save. Each request names the server and its version so that Cleverence can tell MCP traffic
  apart and warn about outdated versions. The server sends nothing anywhere else.
- **Stores:** after you approve the connection in the browser, the server saves the API key in
  `~/.cleverence/credentials.json` on your computer (readable by your user account only), so you
  don't approve it again each session. Remove that file to disconnect.

Label designs, label scripts and renders are stored in your Cleverence Label account, as when you
use the app. See the [privacy policy](https://www.cleverence.com/label/privacy).

## What it costs

Writing and checking a label design uses Claude, not the Cleverence AI allowance. Each render or
printed label counts one label against your plan's monthly label allowance, the same as in the app.
Label scripts and printing on a printer need the Professional plan or higher. See
[pricing](https://www.cleverence.com/label/pricing).

## Support

[www.cleverence.com/label/support](https://www.cleverence.com/label/support)
