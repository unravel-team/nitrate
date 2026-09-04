# Nitrate for Claude Code

This is a generated, self-contained Claude Code plugin bundle. It includes the Nitrate skills, CLI, API client, and stdio MCP server; marketplace installs can be copied into Claude's plugin cache without reaching back into the source repository.

Build and validate it from the repository root:

```sh
node scripts/build-plugin-bundles.mjs
claude plugin validate plugins/claude-code --strict
```

The repository marketplace is `.claude-plugin/marketplace.json` and is named `nitrate-local`. For a local checkout:

```sh
claude plugin marketplace add . --scope local
claude plugin install nitrate@nitrate-local --scope local
```

Plugin executables are added to Claude Code's Bash `PATH`, so `nitrate doctor` exercises the bundled CLI. Node.js 20 or newer is required. Authentication is shared by the bundled CLI and MCP server through the Nitrate login flow.
