---
name: tailwind-v4
description: "Tailwind CSS v4 conventions -- CSS-first config, @theme, @import, no tailwind.config.js. Use when project has Tailwind v4+ (check package.json version or @import 'tailwindcss' in CSS)."
---

# Tailwind CSS v4 Standards

**Detection:** Check `package.json` for `tailwindcss` version `>=4.0.0` OR main CSS file contains `@import "tailwindcss"`. If project uses Tailwind v3 (has `tailwind.config.js`), this skill does NOT apply.

## Breaking Changes from v3

Tailwind v4 is a ground-up rewrite. Key differences:

| v3 | v4 |
|----|-----|
| `tailwind.config.js` | CSS `@theme` block |
| `@tailwind base/components/utilities` | `@import "tailwindcss"` |
| `content` array for purging | Automatic source detection |
| `theme.extend` in JS | `@theme inline { }` in CSS |
| `darkMode: 'class'` in config | `@custom-variant dark (&:is(.dark *))` in CSS |
| Plugin system in JS | CSS `@plugin` directive |

## Configuration (CSS-first)

```css
/* app.css */
@import "tailwindcss";

@theme inline {
  --color-primary: oklch(0.56 0.24 262);
  --color-primary-foreground: oklch(0.98 0 0);
  --color-secondary: oklch(0.78 0.04 262);
  --color-destructive: oklch(0.58 0.22 29);
  --color-muted: oklch(0.96 0.01 262);
  --color-muted-foreground: oklch(0.55 0.02 262);
  --color-border: oklch(0.91 0.01 262);
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.14 0.02 262);

  --font-sans: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --radius-lg: 0.75rem;
  --radius-md: 0.5rem;
  --radius-sm: 0.25rem;

  --spacing-page: 2rem;
}
```

### Custom Variants

```css
/* Dark mode with class toggle */
@custom-variant dark (&:is(.dark *));

/* Custom breakpoints */
@custom-variant mobile (@media (max-width: 639px));
@custom-variant tall (@media (min-height: 800px));
```

### Plugins

```css
/* Load plugins via CSS */
@plugin "@tailwindcss/typography";
@plugin "@tailwindcss/forms";
```

## New Utilities in v4

```html
<!-- Container queries (built-in, no plugin) -->
<div class="@container">
  <div class="@sm:grid-cols-2 @lg:grid-cols-3">...</div>
</div>

<!-- 3D transforms -->
<div class="rotate-x-12 rotate-y-6 perspective-800">...</div>

<!-- Field sizing -->
<textarea class="field-sizing-content"></textarea>

<!-- Color mix -->
<div class="bg-primary/50">...</div>  <!-- 50% opacity -->

<!-- Not variant -->
<div class="not-first:mt-4">...</div>
<div class="not-last:border-b">...</div>

<!-- Starting style (enter animations) -->
<div class="starting:opacity-0 opacity-100 transition">...</div>
```

## Migration Checklist

When upgrading v3 → v4:

1. Remove `tailwind.config.js` — move theme to `@theme inline { }` in CSS
2. Replace `@tailwind base; @tailwind components; @tailwind utilities;` with `@import "tailwindcss";`
3. Remove `content` config — v4 detects sources automatically
4. Replace JS plugins with `@plugin` in CSS
5. Replace `darkMode: 'class'` with `@custom-variant dark`
6. Run `npx @tailwindcss/upgrade` for automated migration

## Common Pitfalls

- **Keeping `tailwind.config.js` without `@config`** — v4 uses CSS-first config. The JS file is not auto-detected. Use `@config "./tailwind.config.js"` in CSS if you need the compatibility layer during migration.
- **Using `@tailwind` directives** — replaced by `@import "tailwindcss"`
- **Using `theme()` function in CSS** — replaced by `var(--...)` CSS custom properties
- **Missing `@theme inline`** — without `inline`, theme values are exported as CSS custom properties but not available as utility classes
- **Old plugin syntax** — JS plugins need `@plugin` directive now
- **Using deprecated utilities** — some v3 utilities renamed. Run the upgrade tool.

## Context7

- **Tailwind CSS:** search for `tailwindcss` — v4 config, utilities, migration guide
