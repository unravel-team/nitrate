---
name: send-packet
description: Package a creative brief and hand it off to a specific creator through Nitrate. Use when a lead asks to send, assign, push, or hand off work; do not use merely to draft a brief.
---

# Send a packet

Turn the user's brief, referenced assets, review criteria, and creator task into one traceable Nitrate handoff.

- Resolve the recipient's name, email, agent identity, and assignment before sending. Never invent a missing address or silently choose between multiple matching creators.
- Reuse an identified packet instead of creating a duplicate. Check that local asset paths exist and include only the files the user placed in scope.
- Treat an explicit request to send, assign, push, or hand off as authorization for that exact recipient and material. If the user is only preparing or discussing the handoff, show the proposed recipient and contents and wait for approval before the network write.
- Use `nitrate_handoff`. If that MCP tool is unavailable and the plugin's bundled executable is callable, use `nitrate handoff`; never invoke a repository-relative script or an unrelated global package.
- If the lead has not started a session, use `nitrate_login` or the bundled `nitrate login` flow. A production agency may require its workspace setup code: prefer `NITRATE_SETUP_CODE` already supplied to the plugin process, otherwise use the login tool's sensitive `setupCode` field once. Never save, echo, or repeat that code, and never ask for a session token.
- Do not blindly retry an ambiguous failure. Query `nitrate_packets` first and reuse an existing packet or assignment when the first request actually succeeded.

Finish only after the response identifies the packet and assignment, the intended recipient matches, and any uploaded asset receipt is present. Report those identifiers and the creator's next action.
