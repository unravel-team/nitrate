---
name: make-with-higgsfield
description: Complete a pulled Nitrate assignment with Higgsfield and return the generated media with its exact provenance. Use when a creator asks to make or generate assigned Nitrate work in Higgsfield or Higgsfield Supercomputer.
---

# Make assigned work with Higgsfield

Carry one Nitrate packet through Higgsfield without losing the production brief or the generation record.

- Start from the assignment already pulled into the current workspace. Read `AGENT_BRIEF.md` and `.nitrate/assignment.json`; do not reconstruct the brief from chat or choose between multiple assignments.
- Treat the packet's review criteria, output folders, and verified input files as the generation contract. Pass the downloaded files from `inputs/` as Higgsfield references when the selected model accepts them. Never substitute a similarly named file or an unverified URL.
- In Codex or another MCP-compatible agent, prefer Higgsfield's official MCP connection when it is already available. In Claude Code or another coding-agent workflow, use Higgsfield's installed official skill or CLI. Check the account or credit status before a paid generation. If the coding-agent integration is absent, explain that the official setup is `npm install --global @higgsfield/cli`, `higgsfield auth login`, and `npx skills add higgsfield-ai/skills`; get approval before installing software.
- Do not hard-code a stale model catalog. Let the Higgsfield skill route the task, or inspect the live model schema before passing model-specific flags. Respect Higgsfield's credit confirmation, and never repeat a possibly successful paid job after a timeout without checking generation history first.
- Preserve the exact final generation prompt, model or workflow name, and Higgsfield job/asset identifier. Save or download the completed media immediately into an allowed packet output folder such as `renders/` or `stills/`; do not return a temporary URL as if it were the deliverable.
- Inspect the real output when the host supports the media type. State any inspection limitation instead of claiming that review criteria passed.
- Return the saved file through `nitrate_return`, with `madeWith` identifying Higgsfield and the selected model/workflow. Pass the exact prompt and concise handoff notes. Finish only when Nitrate returns a receipt containing the uploaded byte count and SHA-256 digest.

When Nitrate is connected directly to Higgsfield Supercomputer as a remote MCP, use the remote flow instead: call `nitrate_pull_assignment`, create from its signed input links and packet rules, then call `nitrate_submit_return_from_url` with the completed Higgsfield asset URL, exact prompt, tool/workflow, output path, and notes. Do not place Nitrate credentials in the asset URL or prompt.
