---
name: review-work
description: Inspect a returned Nitrate deliverable and record an approval, rejection, or changes request. Use for a lead's review decision; do not use for general code review or creative drafting.
---

# Review returned work

Make one evidence-based decision on the intended Nitrate return.

- Resolve the return and its packet review criteria with `nitrate_packets`. If more than one item could be meant, ask the user to choose.
- Inspect the available deliverable plus its prompt, tool, notes, size, and digest. If the actual media cannot be inspected, explain that limitation and do not claim a visual or audio assessment.
- When the user asks only to review, provide findings and a recommendation without recording a decision. An explicit instruction to approve, reject, or request changes authorizes that exact decision.
- Use `nitrate_review` to record the decision. If that MCP tool is unavailable and the plugin's bundled executable is callable, use `nitrate review`; never invoke files outside the installed plugin bundle.
- If authentication is missing or expired, restore the lead/reviewer session through the role-appropriate Nitrate flow. Do not use a creator invitation for a review decision or ask the user to paste a token into chat.
- Make requested changes actionable and tied to the packet criteria. Do not silently convert a recommendation into approval.
- Do not blindly retry an ambiguous write. Read the return again and check its current decision first.

Finish by reporting the return identifier, recorded decision, reviewer, and decision receipt.
