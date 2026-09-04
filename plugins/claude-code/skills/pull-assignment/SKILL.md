---
name: pull-assignment
description: Pull a Nitrate assignment and its verified packet assets into the current workspace. Use when a creator asks to fetch, open, accept, or start assigned Nitrate work.
---

# Pull an assignment

Create a usable local workspace from one unambiguous Nitrate assignment.

- If the user supplied an assignment invite, use it directly. Otherwise use `nitrate_packets` to resolve an assignment from the current session. If several active assignments match, present the concise choices and ask which to pull.
- Choose the requested destination or a fresh descriptive directory. Do not overwrite a nonempty directory unless it already belongs to the same assignment and the pull operation explicitly supports a safe resume.
- Use `nitrate_pull`. If that MCP tool is unavailable and the plugin's bundled executable is callable, use `nitrate pull`; never invoke files outside the installed plugin bundle.
- An unauthenticated creator must pull with the one-time assignment invite URL; `nitrate_pull` and `nitrate pull` accept the invite and create the creator session. Never self-register a creator through `nitrate_login`. If no valid invite is available, ask the lead to issue a new one.
- Read the resulting `AGENT_BRIEF.md` and `.nitrate/assignment.json` before starting creative work.

Verify the packet and assignment identifiers, expected folders, asset count, and available integrity receipts. Surface missing or mismatched assets instead of marking the pull successful. End with a short brief summary and the exact local workspace path.
