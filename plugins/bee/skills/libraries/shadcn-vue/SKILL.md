---
name: shadcn-vue
description: shadcn-vue component library conventions for Vue 3 -- use when project has components.json with vue/nuxt framework or @/components/ui/ directory with Vue SFC files. Covers Radix Vue primitives, composition patterns, theming, and Vue-specific conventions.
---

# shadcn-vue Standards

These standards apply when the project uses shadcn-vue (the Vue 3 port of shadcn/ui). **Detection:** check for `components.json` with `"framework": "vue"` or `"framework": "nuxt"` at project root, OR `@/components/ui/` directory with `.vue` single-file components. If neither exists, this skill does not apply.

**Also read the active stack skill** (vue, laravel-inertia-vue, nuxt) for framework-specific conventions. This skill covers shadcn-vue-specific patterns only.

## Core Architecture

shadcn-vue is NOT a dependency -- it's a **code distribution platform**. Components are copied into your project as `.vue` SFCs. The underlying primitives come from **Radix Vue** (now Reka UI), not Radix UI (which is React-only).

- Components live in `@/components/ui/` (or wherever `aliases.ui` points in `components.json`)
- You OWN the code -- modify, extend, delete as needed
- Updates are manual: `npx shadcn-vue@latest add <component>` overwrites your file
- Dependencies: `radix-vue` or `reka-ui` (primitives — newer versions use reka-ui), `class-variance-authority` (variants), `clsx` + `tailwind-merge` (class merging)

### Project Structure

```
components.json              <- shadcn-vue configuration
src/
  components/
    ui/                      <- shadcn-vue primitives (DO NOT put custom components here)
      Button.vue
      Dialog/
        Dialog.vue
        DialogContent.vue
        DialogHeader.vue
        DialogTitle.vue
      Input.vue
      ...
    custom/                  <- your composed components using shadcn-vue primitives
      UserForm.vue
      DataTableToolbar.vue
  lib/
    utils.ts                 <- cn() utility function
```

### The `cn()` Utility

```typescript
import { cn } from '@/lib/utils'

// In template: use cn() for dynamic class merging
<div :class="cn('px-4 py-2', variant === 'ghost' && 'bg-transparent', props.class)" />
```

Use `cn()` for all dynamic class merging -- never string concatenation or array joining.

## Styling Rules

### Semantic Colors Only

All colors reference CSS variable tokens. Hardcoded colors break theming and dark mode:

```vue
<!-- Correct -->
<p class="text-muted-foreground">Helper text</p>
<div class="bg-card border border-border rounded-lg">...</div>

<!-- Wrong -->
<p class="text-gray-500">Helper text</p>
<div class="bg-white border border-gray-200">...</div>
```

### Spacing and Sizing

- Use `gap-*` instead of `space-y-*` / `space-x-*` for flex layouts
- Use `size-*` when width and height are equal: `class="size-10"` not `class="w-10 h-10"`
- Use `truncate` as shorthand for text overflow
- No manual `z-index` on overlay components -- they manage stacking internally
- No manual `dark:` color overrides -- semantic tokens auto-switch

## Vue-Specific Component Patterns

### Script Setup Convention

All shadcn-vue components use `<script setup lang="ts">`. Follow this in custom components too:

```vue
<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface Props {
  class?: string
  variant?: 'default' | 'destructive' | 'outline'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
})
</script>
```

### Slot-Based Composition (Vue vs React difference)

shadcn-vue uses Vue **slots** where React shadcn uses **children**. This is the key difference:

```vue
<!-- Vue: uses slots -->
<Dialog>
  <DialogTrigger as-child>
    <Button variant="outline">Edit Profile</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Edit Profile</DialogTitle>
      <DialogDescription>Make changes to your profile.</DialogDescription>
    </DialogHeader>
    <slot />  <!-- form content -->
    <DialogFooter>
      <Button type="submit">Save</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### `as-child` Pattern (Radix Vue)

Vue shadcn uses `as-child` (kebab-case) not `asChild` (camelCase):

```vue
<!-- Correct: kebab-case -->
<DialogTrigger as-child>
  <Button>Open</Button>
</DialogTrigger>

<!-- Wrong: React camelCase -->
<DialogTrigger asChild>
  <Button>Open</Button>
</DialogTrigger>
```

### v-model Integration

Many shadcn-vue components support `v-model` directly:

```vue
<script setup lang="ts">
const open = ref(false)
const selectedTab = ref('account')
</script>

<template>
  <!-- Dialog controlled via v-model -->
  <Dialog v-model:open="open">
    <DialogContent>...</DialogContent>
  </Dialog>

  <!-- Tabs controlled via v-model -->
  <Tabs v-model="selectedTab">
    <TabsList>
      <TabsTrigger value="account">Account</TabsTrigger>
      <TabsTrigger value="settings">Settings</TabsTrigger>
    </TabsList>
    <TabsContent value="account">...</TabsContent>
    <TabsContent value="settings">...</TabsContent>
  </Tabs>
</template>
```

## Component Selection Guide

| Need | Use |
|------|-----|
| Button/action | `Button` with variant prop |
| Form inputs | `Input`, `Select`, `Combobox`, `Switch`, `Checkbox`, `RadioGroup`, `Textarea`, `Slider` |
| Data display | `Table`, `Card`, `Badge`, `Avatar` |
| Navigation | `NavigationMenu`, `Breadcrumb`, `Tabs`, `Pagination` |
| Overlays | `Dialog` (modal), `Sheet` (side), `AlertDialog` (confirmation) |
| Feedback | `toast` (sonner), `Alert`, `Progress`, `Skeleton` |
| Layout | `Card`, `Separator`, `ScrollArea`, `Accordion`, `Collapsible` |
| Menus | `DropdownMenu`, `ContextMenu`, `Menubar` |
| Tooltips | `Tooltip`, `HoverCard`, `Popover` |

## Accessibility Requirements

- `Dialog`, `Sheet` require `DialogTitle` / `SheetTitle` -- screen readers need it
- `Avatar` always needs `AvatarFallback`
- `TabsTrigger` must be inside `TabsList`
- Never remove ARIA attributes from Radix Vue primitives
- Use `as-child` on triggers when wrapping custom elements

## Form Patterns

### With VeeValidate + Zod (recommended for shadcn-vue)

```vue
<script setup lang="ts">
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'

const schema = toTypedSchema(z.object({
  email: z.string().email(),
  name: z.string().min(2),
}))

const { handleSubmit } = useForm({ validationSchema: schema })

const onSubmit = handleSubmit((values) => { /* submit */ })
</script>

<template>
  <form @submit="onSubmit">
    <FormField v-slot="{ componentField }" name="email">
      <FormItem>
        <FormLabel>Email</FormLabel>
        <FormControl>
          <Input type="email" v-bind="componentField" />
        </FormControl>
        <FormMessage />
      </FormItem>
    </FormField>
    <Button type="submit">Submit</Button>
  </form>
</template>
```

## Theming

### CSS Variables

Same semantic token system as React shadcn. All colors auto-switch in dark mode:

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0.006 285.885);
  --primary-foreground: oklch(0.985 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
}
```

### Extending Variants

Edit the component file in `ui/` to add custom variants:

```vue
<!-- In @/components/ui/button/Button.vue -->
<script setup lang="ts">
import { cva } from 'class-variance-authority'

const buttonVariants = cva('...base classes...', {
  variants: {
    variant: {
      default: '...',
      destructive: '...',
      success: 'bg-success text-success-foreground hover:bg-success/90', // added — use semantic tokens
    },
  },
})
</script>
```

Do not create wrapper components just to add a className -- extend the variant system.

## CLI Workflow

```bash
# Add components
npx shadcn-vue@latest add button dialog input

# Preview before adding
npx shadcn-vue@latest add button --dry-run

# Diff before overwriting
npx shadcn-vue@latest add button --diff

# Search
npx shadcn-vue@latest add --all  # see available components
```

### Safe Update

1. `npx shadcn-vue@latest add <component> --dry-run`
2. `npx shadcn-vue@latest add <component> --diff`
3. Review diff, decide per-file
4. Never use `--overwrite` without checking your customizations first

## Common Pitfalls

- **Using `asChild` (camelCase)** -- Vue uses `as-child` (kebab-case). React examples don't apply directly.
- **Missing `cn()` import** -- forgetting `@/lib/utils` when adding dynamic classes
- **Hardcoded colors** -- `text-gray-500` breaks in dark mode. Use `text-muted-foreground`
- **Putting custom components in `ui/`** -- reserved for shadcn primitives only
- **Wrapping every component** -- extend variants, don't create `MyButton.vue`
- **Mixing Radix Vue direct imports with shadcn wrappers** -- pick one per component
- **Missing DialogTitle** -- screen readers require it. Causes accessibility violation
- **FormField without FormMessage** -- validation errors exist but aren't displayed
- **Using React examples directly** -- Vue shadcn has different slot patterns, different prop naming, different composition

## Context7 Instructions

- **shadcn-vue:** search for `shadcn-vue` -- Vue port, components, Radix Vue integration
- **Radix Vue / Reka UI:** search for `radix-vue` or `reka-ui` -- underlying Vue primitives, accessibility, composition
- **VeeValidate:** search for `vee-validate` -- form validation with Zod integration
- **TanStack Table (Vue):** `tanstack/table` -- data table with Vue adapter
