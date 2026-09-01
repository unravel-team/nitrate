---
name: Nitrate
description: A calibrated review-room system for collaborative AI video production.
colors:
  electric-violet: "#6c35ff"
  bright-violet: "#815cff"
  review-orange: "#ff5038"
  projection-ink: "#08080a"
  raised-ink: "#101014"
  projection-white: "#f4f2ed"
  dim-paper: "#d8d5ce"
  accessible-muted: "#aaa7b0"
  pure-white: "#ffffff"
typography:
  display:
    fontFamily: "League Gothic, Arial Narrow, sans-serif"
    fontSize: "clamp(4.2rem, 8vw, 7.5rem)"
    fontWeight: 400
    lineHeight: 0.88
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "League Gothic, Arial Narrow, sans-serif"
    fontSize: "clamp(3.4rem, 5.2vw, 5.3rem)"
    fontWeight: 400
    lineHeight: 0.88
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Manrope, Helvetica Neue, sans-serif"
    fontSize: "clamp(1rem, 1.25vw, 1.18rem)"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Manrope, Helvetica Neue, sans-serif"
    fontSize: "0.65rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  square: "0px"
  status-dot: "50%"
spacing:
  page-gutter: "clamp(1rem, 2.4vw, 2.5rem)"
  section-pad: "clamp(5rem, 10vw, 9rem)"
  control-x: "1rem"
  control-y: "0.8rem"
components:
  button-primary:
    backgroundColor: "{colors.projection-white}"
    textColor: "{colors.projection-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "0.8rem 1rem 0.8rem 1.2rem"
    height: "3.2rem"
  button-primary-hover:
    backgroundColor: "{colors.bright-violet}"
    textColor: "{colors.pure-white}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "0.8rem 1rem 0.8rem 1.2rem"
    height: "3.2rem"
  button-review:
    backgroundColor: "transparent"
    textColor: "{colors.projection-white}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "0 0.7rem"
    height: "2.45rem"
  button-review-approved:
    backgroundColor: "{colors.electric-violet}"
    textColor: "{colors.pure-white}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "0 0.7rem"
    height: "2.45rem"
  field:
    backgroundColor: "transparent"
    textColor: "{colors.projection-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "0"
    height: "3.2rem"
---

# Design System: Nitrate

## Overview

**Creative North Star: "The Review Room"**

Nitrate feels like a calibrated agency review room: projection-black surrounds focus attention on the work, projection white makes the category argument legible, electric violet shows production state, and red-orange grease marks call for a decision. The system is direct, screen-first, and operational rather than dashboard-like; the media and its attached context are always more important than chrome.

The visual grammar uses compressed film-title type, hard cuts, thin rules, sharp rectangular controls, and almost no rounded surfaces. Motion explains production flow: a single playhead carries the brief through creator assignments and AI tools into review, review marks draw once, and still changes remain fast and interruptible. Decorative looping is outside the system.

**Key Characteristics:**

- Calibrated black viewing surrounds with a projection-white category bridge.
- Electric violet for active production flow; review orange for human attention and decisions.
- League Gothic headlines paired with precise Manrope body and interface copy.
- Sharp surfaces, thin rules, hard-offset sheets, and status circles instead of pill chrome.
- Media-first review context and one-shot motion that remains fully legible when reduced.

## Colors

The palette separates the viewing room, projected argument, live production state, and human review mark with high-contrast, role-specific color.

### Primary

- **Electric Violet** (`#6c35ff`): carries the production path, large interruption fields, active states, and hard-offset emphasis.
- **Bright Violet** (`#815cff`): supplies higher-luminance active edges, selected returns, hover states, and readable violet accents on ink.

### Secondary

- **Review Orange** (`#ff5038`): marks comments, playheads, pending review attention, and the global focus outline. It is a human annotation color, not a general decoration.

### Neutral

- **Projection Ink** (`#08080a`): the calibrated viewing surround, page ground, and primary text on light fields.
- **Raised Ink** (`#101014`): separates review-room and tool surfaces from the black surround without pretending they float.
- **Projection White** (`#f4f2ed`): the category bridge, paper-like assignment surfaces, controls, and primary copy.
- **Dim Paper** (`#d8d5ce`): secondary light-on-dark information such as timecode and supporting metadata.
- **Accessible Muted** (`#aaa7b0`): subdued labels and context copy that must remain readable against the dark room.
- **Pure White** (`#ffffff`): reserved for text on saturated violet and selected high-contrast controls.

### Named Rules

**The Two-Signal Rule.** Violet communicates production state; orange communicates review attention. Do not swap them or add competing accents.

**The Projection Bridge Rule.** Use projection white as a deliberate full-section change of material when explaining the DAM category or asking for commitment, not as scattered light cards on the dark page.

**The Status-Is-Words Rule.** Every colored state dot is paired with a plain-language label; color never carries status alone.

## Typography

**Display Font:** League Gothic (with Arial Narrow and sans-serif fallback)<br>
**Body Font:** Manrope (with Helvetica Neue and sans-serif fallback)<br>
**Label/Mono Font:** Manrope for labels; tabular numerals in the body stack for timecode.

**Character:** League Gothic gives the page the scale and compression of a film title or review-room slate. Manrope keeps buyer copy, metadata, controls, and production details measured and unambiguous.

### Hierarchy

- **Display** (400, `clamp(4.2rem, 8vw, 7.5rem)`, 0.88): section-scale declarations with tightly balanced wrapping.
- **Headline** (400, `clamp(3.6rem, 6vw, 6rem)`, 0.88): workflow scenes and supporting feature statements.
- **Body** (500, `clamp(1rem, 1.25vw, 1.18rem)`, 1.6): explanatory copy, generally held to roughly 31–43rem.
- **Label** (800, `0.65rem`, `0.08em`, uppercase): controls, stages, assignments, and production metadata; nearby values can remain sentence case.
- **Timecode** (500, `0.68rem`, `0.11em`, tabular numerals): precise playback context without introducing a separate monospace identity.

### Named Rules

**The Film-Title Rule.** League Gothic is for declarations and the wordmark, never paragraphs, form values, or dense review metadata.

**The Operational Label Rule.** Small uppercase labels must use weight and contrast together; never rely on tracking alone to make tiny text legible.

## Layout

The desktop landing page uses a 12-column editorial grid with a fluid page gutter (`clamp(1rem, 2.4vw, 2.5rem)`) and generous section padding (`clamp(5rem, 10vw, 9rem)`). The hero gives the review stage visual priority, positions the promise beside it, and follows with a full-width production map. That map uses a one-to-many-to-one topology—agency lead, parallel creators, shared review room—so the collaboration model reads before the labels do. Major sections alternate between dark viewing space, a projection-white category bridge, and full-violet interruption fields. Thin horizontal rules, rather than card gutters, organize long sequences.

At `1180px`, the review stage keeps precedence while its context column, return thumbnails, and production-map columns compact. At `920px`, content becomes a single-column reading order and nonessential navigation links disappear. At `680px`, the composition becomes truly screen-first: the compact player, return context, and horizontally scrollable return strip precede the hero copy; the production map reflows vertically as brief → branched creator lanes → review; controls become full width; and the page gutter resolves to `1rem`. The minimum supported viewport is `320px`.

**The Screen-First Rule.** On phones, prove the review workflow before presenting the marketing claim; do not move the hero copy back above the player.

## Elevation & Depth

The system is flat by default and uses no ambient card shadows. Depth comes from tonal separation, thin rules, media vignettes, and the contrast between projection-white leader surfaces and dark or violet creator-agent surfaces. The leader-to-creator round trip stays in one ruled plane so its direction is easier to follow than a stack of floating artifacts. Soft state halos belong only to tiny status dots.

### Shadow Vocabulary

- **Frame Vignette** (`inset 0 -5rem 5rem rgba(0, 0, 0, 0.46)`): preserves playback-control contrast over media.
- **Focus Underline** (`0 2px 0 #6c35ff`): reinforces the active border on light form fields.

### Named Rules

**The Flat-Room Rule.** Surfaces sit in the same calibrated plane unless an overlapping production artifact needs a hard offset; never add soft SaaS card shadows.

## Shapes

Buttons, fields, navigation calls to action, review surfaces, tool cells, and production sheets use square corners (`0px`). One-pixel neutral rules and two-pixel active edges define boundaries. Circular geometry is restricted to status dots, scrub handles, the production playhead, and the occasional oversized background construction; it does not soften containers.

**The Hard-Cut Rule.** If an element holds content or accepts input, keep it rectangular and square. Reserve circles for position, status, or a drawn construction.

## Components

### Buttons

- **Shape:** square, compact, and label-led, with a minimum primary height of `3.2rem`.
- **Primary:** projection white on ink in the dark room; ink on projection white in the pilot section. Both move to violet on hover.
- **Hover / Focus:** lift by `2px` with the standard exit easing; arrows travel `4px`; all focus-visible states use a `2px` review-orange outline offset by `4px`.
- **Active / Disabled:** active controls return to the plane and compress to `0.985`; form submission disables repeat input and preserves readable status text.
- **Review action:** starts as a transparent, light-stroked control and becomes electric violet with the explicit label “Approved” when pressed.

### Cards / Containers

- **Corner Style:** square (`0px`) with clipped media and no generic card rounding.
- **Background:** raised ink for review modules, projection white for assignment sheets, and saturated violet for creator workflow interruptions.
- **Shadow Strategy:** flat unless the object is intentionally represented as a physical sheet or stacked return.
- **Border:** one-pixel translucent rules at rest; selected review surfaces use a brighter violet edge or two-pixel active bar.
- **Internal Padding:** compact in the review room (`0.65–1.2rem`) and more generous on production sheets (`1.3–2.5rem`).

### Inputs / Fields

- **Style:** transparent square fields on projection white with a single dark bottom rule and `3.2rem` minimum height.
- **Focus:** the bottom rule turns electric violet and gains a matching `2px` underline; the global review-orange focus outline remains available to keyboard users.
- **Error / Disabled:** errors use explicit copy plus a darkened review-orange tone; disabled submission lowers opacity but keeps its label readable.

### Navigation

The sticky dark header uses the League Gothic wordmark, compact uppercase Manrope links, a thin bottom rule, and one square outlined pilot CTA. Link underlines draw from left to right on hover or focus. Below `920px`, the pilot CTA and wordmark remain while supporting links collapse.

### Review Stage

The signature review stage combines a 16:9 media frame, attached creator/tool/status context, an approve action, and a four-return selection strip. The selected still changes with a fast, interruptible fade and restrained scale; user click, focus, or keyboard navigation takes control from the automatic first-run sequence. Arrow, Home, and End keys navigate the tablist.

### Production Map

The workflow map is a primary explanatory object, not a progress indicator. Its fictional Northwind campaign shows Maya attaching one campaign brief, brand guide, approved assets, and mandatory brand rules, then sending that shared source of truth with three distinct ad concepts to Jonas, Nia, and Asha. The product-first reveal, commuter story, and brand-world montage fan out along violet assignment routes and converge along review-orange routes into one campaign review. Every creator lane explicitly carries the same brief and brand guide; the endpoint checks the returned variants against one brand standard. The routes draw once when the map enters view and can be replayed explicitly; reduced motion displays the complete static topology. On mobile, the same semantic order stacks vertically and the creator group keeps a visible branching spine.

### Works With Banner

A full-width banner directly below the production map makes compatibility a major proof point rather than utility metadata. A saturated violet introduction block uses a large “Works with” title and one sentence explaining that Nitrate coordinates the campaign around the tools creators already use. Three equal dark cells display Codex, Higgsfield Supercomputer, and Claude Code with official, unaltered marks on projection-white clear-space plates. The visible product names carry meaning; logo images are decorative and keep empty alt text. Do not recolor, trace, distort, animate, or expand this into an exhaustive tool cloud.

### Broken Handoff Ledger

The violet problem section must diagnose fragmentation at a glance. Its declaration is “The work comes back. The context doesn’t.” A ruled ledger then shows three broken handoffs—Notion brief, Slack feedback, and Drive exports—with an orange missing-context label between each source and the review question it creates. The final ink block names the agency lead’s consequence: reconstructing creator, brief, prompt, feedback, and latest export by hand. Orange is reserved for the missing link and the human burden; Notion, Slack, and Drive remain text labels rather than another logo strip. On mobile, preserve the order declaration → evidence rows → consequence.

### Leader-to-Creator Round Trip

“How it works” is one large operational board with three explicit lanes: agency leader, Nitrate, and creator. It shows the real sequence rather than three disconnected feature scenes. First, the leader uses the dashboard or the Nitrate plugin in Codex or Claude Code to package the shared brief, brand rules, approved inputs, return structure, and creator-specific routes. Nitrate then pushes a focused assignment into each creator’s AI agent. The creator pulls the assignment, works in their existing media tools, and syncs the finished file with prompt, notes, source files, assignment, and version. The same result lands in leader review, where feedback is routed back to that exact creator, assignment, and version.

Leader surfaces use projection white; creator-agent surfaces use raised ink with violet chrome; return routes use review orange. Directional lines animate once when the board enters view, while all labels and states remain readable without motion. The only simulated control is “Accept & pull assignment,” which expands supplemental workspace details; the essential folder summary is always visible. On mobile, the board stacks in chronological order: leader sends → creator receives → creator returns → leader reviews → feedback returns to creator.

## Do's and Don'ts

### Do:

- **Do** let media and its review context own the first visual impression.
- **Do** use projection white for the category bridge and commitment moments.
- **Do** pair violet and orange state indicators with plain-language labels.
- **Do** preserve the current zero-violation desktop and mobile Axe baseline: keep interactions keyboard reachable, focus visible, contrast at WCAG 2.2 AA, and media meaning available through text alternatives.
- **Do** make motion purposeful, one-shot, interruptible, and complete under `prefers-reduced-motion`.

### Don't:

- **Don't** reintroduce the warm-paper, teal, amber, or generic DAM-dashboard direction.
- **Don't** wrap the page in rounded cards, pills, glass panels, or soft ambient shadows.
- **Don't** use violet as an all-purpose decoration or orange as a generic secondary accent.
- **Don't** loop decorative motion, conceal content before JavaScript runs, or leave reduced-motion users with an incomplete sequence.
- **Don't** separate a returned frame from its creator, tool, prompt, notes, assignment, or review state.
