# Nitrate for Codex

This is a generated, self-contained Codex plugin bundle. It includes the Nitrate skills, CLI, API client, and stdio MCP server; installed copies do not read runtime files from the source repository.

Build it from the repository root:

```sh
node scripts/build-plugin-bundles.mjs
```

The repository marketplace is `.agents/plugins/marketplace.json` and is named `nitrate-local`. After installing the plugin, start a new thread and ask naturally to send a packet, pull an assignment, return work, or review a return.

Node.js 20 or newer is required. Authentication is shared by the bundled CLI and MCP server through the Nitrate login flow.
