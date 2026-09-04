---
name: return-work
description: Upload finished media and its prompt, tool, and handoff notes to the matching Nitrate assignment. Use when a creator asks to return, submit, sync, or send completed work back to the lead.
---

# Return work

Attach the actual deliverable and its provenance to the assignment that produced it.

- Prefer the assignment recorded in `.nitrate/assignment.json`. If there is no workspace marker, resolve it with `nitrate_packets`; never guess between multiple assignments.
- Confirm every requested deliverable exists and is a readable file. Preserve the user's real prompt and creation-tool details rather than reconstructing or embellishing them. Ask only for provenance required by the return contract that is genuinely missing.
- Treat an explicit request to return, submit, sync, or send as authorization to upload the stated files. A request to prepare or inspect a return does not authorize submission.
- Use `nitrate_return`. If that MCP tool is unavailable and the plugin's bundled executable is callable, use `nitrate return`; never invoke a repository-relative script or an unrelated global package.
- If authentication is missing or expired, follow the role-appropriate recovery reported by Nitrate. A creator uses a valid assignment invite rather than `nitrate_login`; do not ask the user to paste a token into chat.
- Do not blindly retry after a timeout or lost response. Query `nitrate_packets` and look for a receipt matching the assignment and file hash first.

Finish only when the server receipt identifies the return and assignment and reports the uploaded file's size and digest. Report the receipt and whether the item is now awaiting review.
