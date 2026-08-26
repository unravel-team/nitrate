# Design

<!-- impeccable:design-schema 1 -->

## Visual world

**Production packet and dispatch board.** nitrate is where a lead turns a brief into a structured packet, pushes it to creators' clankers, and reviews the work that returns. The interface should feel like a practical studio operations surface: packets, assignments, input assets, folder contracts, clanker status, returned media, and decision history.

## Direction contract

- Warm paper and near-black ink carry the working surface; teal is reserved for primary action and returned/ready state.
- Amber means in progress or waiting on a creator; red means rejection or decision risk.
- The product mechanism is visible quickly: brief, inputs, output contract, clankers, returns, review.
- Cards are used for repeated items such as returns, clankers, and templates. Page sections remain open layouts.
- Buyer-facing language uses media production words: brief, assets, clanker, creator, return, review, packet, output folders.
- Technical values exist in product surfaces only where they help recreate or inspect returned work.

## Type

System-first stack for speed and legibility. Letter spacing remains neutral. Monospace is reserved for file paths, folder names, IDs, seeds, and timestamps.

## Motion

Motion confirms workflow changes: packet dispatch, clanker return, drawer entrance, status transition, and copy/share confirmation. Durations remain under 240 ms and respect `prefers-reduced-motion`.

## Accessibility floor

- Keyboard paths cover packet selection, return import, triage, compare, comment, approve/reject, share, and role switching.
- Focus is visible in both themes and never hidden by drawers or toasts.
- Status never depends on color alone.
- Media previews have descriptive names and roles; controls expose accessible names.
- Target sizes and contrast meet WCAG 2.2 AA intent.

## Surface strategy

- **Landing:** make the offer clear within seconds: nitrate pushes briefs and assets to creators' clankers, then collects finished work back for lead review.
- **Use cases:** lead with moments where scattered AI work becomes shared understanding.
- **App:** optimize the daily lead loop: inspect packet, see clanker status, review returned work, send next pass, approve or reject.
- **Press:** separate shipped MVP facts from roadmap items such as direct clanker sync, production integrations, and compliance reporting.
