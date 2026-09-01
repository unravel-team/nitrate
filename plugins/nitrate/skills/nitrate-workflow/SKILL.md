---
name: nitrate-workflow
description: "Use Nitrate as the primary plugin surface for AI media agency work: create packets, pull assigned work, update status, and sync returns."
---

# Nitrate workflow

Nitrate is the plugin-first control layer for AI media teams. Use it when the user asks to coordinate AI media work, inspect assigned packets, prepare a local AI coding agent workspace, or return generated media to the lead.

## Core loop

Leader:

1. Log in with `nitrate login --role leader`.
2. Create a client packet with `nitrate init-agency` or `nitrate packet:create`.
3. Push the packet to creator AI coding agents with `nitrate push`.
4. Ask `nitrate next` to see what needs attention.
5. Review returned media in the command center only when visual review is needed.

Creator:

1. Log in with `nitrate login --role member`.
2. Run `nitrate next`.
3. Pull the assigned packet with `nitrate pull`.
4. Work inside the generated folder. Read `AGENT_BRIEF.md` first.
5. Mark progress with `nitrate status --status working`.
6. Return work with `nitrate sync --file <path> --name <name> --made-with <tool> --prompt <prompt>`.

## Product rules

- The plugin is the main entry point. Do not force users into the web app for normal packet work.
- Always keep packet context, input assets, folder contract, prompt, tool, creator, and review status together.
- If the user is inside a pulled Nitrate workspace, infer packet and assignment from `.nitrate/assignment.json`.
- Use the web command center for review, comparison, and sharing; use the plugin for day-to-day work.
