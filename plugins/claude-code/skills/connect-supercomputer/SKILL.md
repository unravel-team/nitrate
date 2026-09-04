---
name: connect-supercomputer
description: Create, inspect, or revoke a dedicated Nitrate remote MCP connection for Higgsfield Supercomputer or another supported custom MCP connector. Use only when the user asks to connect Nitrate remotely or manage that connection.
---

# Connect Nitrate to Supercomputer

Use a dedicated remote-MCP credential, never the user's ordinary Nitrate session.

- Check the local Nitrate session first with `nitrate_whoami` or `nitrate whoami`. If it is absent, use the normal Nitrate login flow; do not ask the user to paste a session token into chat.
- Before minting a connection, state its label and lifetime (seven days by default, maximum 30) and obtain explicit confirmation. Then use `nitrate_create_remote_connection` with `confirmed: true`, or `nitrate mcp:connect --name ... --days ...` after confirmation.
- Explain before creation that this credential is scoped, expires, can be revoked independently, and is displayed once. Do not copy it into a file, local Nitrate config, follow-up message, log, or recap.
- Direct the user to paste the Nitrate deployment's `/mcp` URL and the one-time value as `Authorization: Bearer <token>` into a supported custom remote MCP connector. Do not claim a particular Higgsfield Supercomputer UI path or connector capability unless the user has supplied it.
- Have the connected agent test the connection with its remote `nitrate_whoami` and `nitrate_list_work` tools. If it cannot authenticate, list the connection metadata locally; never request that the user paste the bearer secret back into chat.
- List connections with `nitrate_list_remote_connections` or `nitrate mcp:list`. Before revocation, identify the exact connection and obtain explicit confirmation, then use `nitrate_revoke_remote_connection` with `confirmed: true` or `nitrate mcp:disconnect <id>`.
- Revoke the connection immediately if the credential may have been exposed, the connector is no longer needed, or the user asks to disconnect it. Create a replacement only after fresh confirmation.
