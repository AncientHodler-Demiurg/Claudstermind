---
name: frontend-standards
description: Universal frontend standards -- component architecture, accessibility, responsive design, CSS methodology, design quality. Applies to ALL frontend stacks automatically.
---

# Frontend Standards

These standards apply to ALL frontend code regardless of framework (Vue, React, Svelte, etc.). They define stack-agnostic principles -- the "what" and "why" of frontend quality. Framework-specific "how" belongs in stack skills.

**Library detection:** If the project uses shadcn/ui (check for `components.json` at project root OR `@/components/ui/` directory), read the appropriate shadcn skill: **`skills/libraries/shadcn-ui/SKILL.md`** for React projects, **`skills/libraries/shadcn-vue/SKILL.md`** for Vue/Nuxt projects. Check `components.json` `"framework"` field to determine which.

## Component Architecture

### Single Responsibility

- One component, one purpose. A component that fetches data, transforms it, and renders a complex layout is doing too much.
- If a component needs a comment to explain what it does, it should be split into smaller components.
- **Max 250 lines per visual component.** Over 250 lines is a signal to decompose.

### No Business Logic in Visual Components

- **Visual components render UI only.** They receive data via props/slots, render JSX/template, and emit events.
- **Extract all logic into hooks/composables:** Data fetching, transformations, validation, state machines, business rules — all belong in custom hooks (React) or composables (Vue).
- Components orchestrate hooks and render — nothing else.
- This separation makes components reusable, testable, and readable.

### Reusability

- Extract repeated UI patterns into shared components after seeing the pattern 3 times (Rule of Three).
- Shared components accept props for customization -- they are configurable, not hardcoded.
- Shared components live in a dedicated directory (e.g., `components/shared/` or `components/ui/`).

### Composition Over Inheritance

- Build complex UIs by composing smaller components, not by extending base components.
- Use slots/children for content injection -- parent controls content, child controls layout.
- Avoid deep component hierarchies. Flatten when composition achieves the same result.

### Props Design

- Minimal props: only what the component needs. Avoid passing entire objects when only one field is used.
- Well-typed: define explicit types/interfaces for all props. No `any` or untyped props.
- Sensible defaults: optional props have reasonable default values.
- Boolean props default to `false` -- presence means true (`<Modal visible>` not `<Modal visible={true}>`).

### State Colocation

- Keep state as close to where it is used as possible. Do not lift state higher than necessary.
- If only one component uses a piece of state, that state belongs in that component.
- Lift state only when siblings need to share it -- lift to the nearest common ancestor.
- Global state is for truly global concerns: authenticated user, theme, locale.

## Design Quality

### Intentional Aesthetics

- Every interface must have a **clear aesthetic direction** — not generic defaults. Before coding, decide on the tone: minimal, playful, editorial, industrial, luxury, brutalist, etc.
- **Typography matters:** Choose fonts that are beautiful and contextually appropriate. Avoid defaulting to system fonts, Inter, or Roboto without reason. Pair a distinctive display font with a refined body font.
- **Color with purpose:** Commit to a cohesive palette. Use CSS variables/tokens for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Spatial composition:** Consider asymmetry, overlap, generous negative space, or controlled density. Don't default to centered-everything-on-white.

### Avoid Generic AI Aesthetics

- **NEVER** default to purple gradients on white backgrounds.
- **NEVER** use the same font family across different projects without reason.
- **NEVER** produce cookie-cutter layouts that look like every other AI-generated UI.
- Each project should feel **designed for its specific context** — not templated.

### Motion and Micro-Interactions

- Use animations to enhance UX, not decorate. Focus on high-impact moments: page transitions, loading states, hover feedback, staggered reveals.
- Prefer CSS animations/transitions over JavaScript animation libraries when possible.
- One well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions.
- Use `prefers-reduced-motion` media query to respect user preferences.

### Visual Details

- **Backgrounds:** Create atmosphere with gradient meshes, noise textures, geometric patterns, layered transparencies — not just solid colors.
- **Shadows and depth:** Use layered shadows for realistic elevation. Avoid single-shadow flat design.
- **Borders and dividers:** Subtle borders, custom dividers, or spacing can separate sections. Choose contextually.
- **Icons:** Use a consistent icon set. Mix icon libraries = visual chaos.

## Accessibility (a11y)

### Semantic Structure

- Use appropriate semantic elements: buttons for actions, links for navigation, headings for hierarchy.
- Heading levels must be sequential (`h1` then `h2`, never skip to `h3`). One `h1` per page/screen.
- Lists for groups of related items. Tables for tabular data. Forms with labels for inputs.

### Keyboard Navigation

- All interactive elements must be keyboard accessible: focusable, activatable with Enter/Space.
- Tab order follows visual order. Use natural DOM order, avoid manual `tabIndex` values above 0.
- Trap focus in modals and dialogs -- Tab cycles within the modal, not behind it.
- Restore focus to the triggering element when a modal closes.

### ARIA

- Prefer native semantics over ARIA. A `<button>` is better than `<div role="button">`.
- Use ARIA when native semantics are insufficient: `aria-label` for icon-only buttons, `aria-describedby` for help text, `aria-expanded` for collapsible sections.
- `aria-live="polite"` for dynamic content updates that screen readers should announce.
- Never use `aria-hidden="true"` on focusable elements.

### Color and Contrast

- **WCAG AA minimum:** 4.5:1 contrast ratio for normal text, 3:1 for large text (18px+ or 14px+ bold).
- Never convey information by color alone -- use icons, patterns, or text labels alongside color.
- Test with color blindness simulators. Red/green distinctions are invisible to ~8% of males.

### Touch Targets

- Minimum touch target size: 44x44px for mobile interfaces.
- Adequate spacing between touch targets to prevent accidental taps.
- Larger targets for primary actions (buttons, CTAs).

## Responsive Design

### Mobile-First

- Start with the mobile layout as the base. Add complexity for larger screens via breakpoints.
- Mobile-first ensures the essential experience works on the smallest screens.
- Progressive enhancement: mobile gets the core, desktop gets the enhancements.

### Breakpoint Strategy

- Use consistent, named breakpoints across the project: `sm`, `md`, `lg`, `xl`.
- Define breakpoints in a central location (design tokens, config). Do not hardcode pixel values inline.
- Design for breakpoint ranges, not exact screen sizes. Content should be fluid between breakpoints.

### Fluid Layouts

- Avoid fixed widths. Use percentages, `flex`, and `grid` for layouts that adapt to container size.
- Set `max-width` on content containers to prevent lines from becoming unreadably long on wide screens.
- Use relative units (`rem`, `em`) for spacing and typography to respect user font size preferences.

### Responsive Media

- Use `srcset` / `<picture>` for resolution-appropriate images on web.
- Lazy load images below the fold for performance.
- Responsive video and embedded content: maintain aspect ratio with aspect-ratio or padding technique.

### Content Priority

- Show essential content first on all screen sizes. Progressive disclosure for secondary content.
- Navigation should be accessible on all screen sizes -- collapse to hamburger/bottom tabs on mobile.
- Critical actions (CTA buttons) must be visible without scrolling on mobile.

## CSS Methodology

### Design Tokens

- Centralize visual design decisions as tokens: colors, spacing scale, typography scale, border radius, shadows.
- Use CSS custom properties or framework config (Tailwind `theme.extend`) for tokens.
- Semantic token names: `--color-primary`, `--spacing-md`, `--font-size-heading`. Not `--blue-500` or `--size-16`.
- All components reference tokens, never raw values. Changing a token updates the entire UI.

### Utility-First

- Prefer utility classes (Tailwind CSS) over custom CSS when the framework supports it.
- Utility-first reduces CSS file size, eliminates naming debates, and colocates styles with markup.
- For projects without utility frameworks, use a consistent methodology (BEM, CSS Modules).

### Component Extraction

- When a utility combination repeats across components, extract to a reusable component (not a CSS class).
- Component extraction > CSS extraction: styles stay colocated with behavior and markup.

### Dark Mode

- Define all colors as CSS custom properties with both light and dark variants
- Use `prefers-color-scheme` media query for system preference, or `.dark` class for manual toggle
- Test every component in both modes -- hardcoded colors that look fine in light mode break in dark mode
- Semantic tokens that switch values: `:root { --bg: #fff; }` / `.dark { --bg: #111; }`
- With Tailwind v3: `dark:` variant, configure `darkMode: 'class'` in config. With Tailwind v4: `@custom-variant dark` in CSS (see tailwind-v4 skill)
- Never assume light mode -- always check contrast ratios against both backgrounds

### Avoid

- **!important** -- signals a specificity problem. Fix the cascade instead.
- **Deep nesting** -- max 3 levels. Flat selectors are more maintainable and performant.
- **Magic numbers** -- use design tokens for spacing, sizing, and timing values.
- **Unscoped global styles** -- global styles should only set resets and base typography. Component styles must be scoped.
- **Inline style objects in render** -- creates new references on every render, causing unnecessary re-renders in virtual DOM frameworks.

## Performance

### Rendering

- Minimize re-renders. Memoize expensive computations and stable references where the framework allows.
- Virtualize long lists (100+ items). Rendering all items at once causes jank and memory pressure.
- Avoid layout thrashing: batch DOM reads before DOM writes. Do not interleave reads and writes.

### Loading

- Lazy load routes and heavy components. The initial bundle should contain only what the first screen needs.
- Optimize images: compress, use modern formats (WebP, AVIF), and size appropriately for display dimensions.
- Minimize third-party scripts. Each script adds to parse time and competes for the main thread.
- Measure performance with real devices, not just desktop dev tools. Mobile CPUs are significantly slower.

### Core Web Vitals

- **LCP (Largest Contentful Paint):** Optimize hero images/text to render within 2.5s. Preload critical resources.
- **INP (Interaction to Next Paint):** Keep main thread responsive. Break long tasks, defer non-critical work.
- **CLS (Cumulative Layout Shift):** Reserve space for images/ads/embeds. Set explicit `width`/`height` on media. Avoid injecting content above the fold after load.
