# nitrate for Claude Code

Claude Code uses the same open-source `nitrate` CLI and MCP server as the Codex plugin.

## Install CLI

```sh
npm install -g nitrate
```

For local development from this repo:

```sh
npm link
```

## Log in

```sh
nitrate login \
  --api https://nitrate.example.workers.dev \
  --role member \
  --name "Jonas Reyes" \
  --email jonas@studio.test \
  --agent jonas-agent \
  --surface "Claude Code"
```

## Add MCP server

Point Claude Code at `mcp/server.mjs` from this repo, or at the installed package's MCP entry if packaged by your distribution flow.

Example local config shape:

```json
{
  "mcpServers": {
    "nitrate": {
      "command": "node",
      "args": ["/absolute/path/to/nitrate/mcp/server.mjs"],
      "env": {
        "NITRATE_API_URL": "https://nitrate.example.workers.dev"
      }
    }
  }
}
```

The MCP server reads `~/.nitrate/config.json`, so `nitrate login` is usually enough. `NITRATE_TOKEN` can be supplied explicitly for locked-down deployments.

## Team-member loop

Start with the plugin next action:

```sh
nitrate next
```

Then pull the assigned packet. If only one packet is assigned, IDs are inferred:

```sh
nitrate packets
nitrate pull --dir ./launch-film
cd ./launch-film
nitrate status --status working
nitrate sync --file ./renders/jonas-v1.mp4 --name "Jonas v1" --made-with "Claude Code" --prompt "..."
```

## Leader loop

```sh
nitrate login --api https://nitrate.example.workers.dev --role leader --name "Maya Chen" --email maya@studio.test --agent maya-lead --surface "Claude Code"
nitrate init-agency --name "Launch Film Packet" --client "Northwind" --brief "Create a 30-second launch-film direction" --creator "Jonas Reyes|jonas@studio.test|jonas-agent|Explore the human performance beat"
nitrate push --packet pkt_... --name "Jonas Reyes" --email jonas@studio.test --agent jonas-agent --task "Explore the human performance beat"
```
