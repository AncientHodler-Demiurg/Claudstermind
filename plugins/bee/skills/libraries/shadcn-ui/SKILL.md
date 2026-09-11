---
name: shadcn-ui
description: shadcn/ui component library conventions -- use when project has components.json or @/components/ui/ directory. Covers component usage, customization, theming, composition patterns, and common pitfalls.
---

# shadcn/ui Standards

These standards apply when the project uses shadcn/ui. **Detection:** check for `components.json` at project root OR `@/components/ui/` directory with shadcn component files. If neither exists, this skill does not apply.

**Also read the active stack skill** (react, vue, nextjs, etc.) for framework-specific conventions. This skill covers shadcn-specific patterns only.

## Core Architecture

### How shadcn/ui Works

shadcn/ui is NOT a dependency -- it's a **code distribution platform**. Components are copied into your project and become YOUR code. This means:

- Components live in `@/components/ui/` (or wherever `aliases.ui` points in `components.json`)
- You OWN the code -- modify, extend, delete as needed
- Updates are manual (`npx shadcn@latest add <component>` overwrites your file)
- No `node_modules` shadcn package -- only the underlying primitives (Radix UI, etc.)

### Project Structure

```
components.json              <- shadcn configuration (aliases, style, base color)
src/
  components/
    ui/                      <- shadcn primitives (DO NOT put custom components here)
      button.tsx
      dialog.tsx
      input.tsx
      ...
    custom/                  <- your composed components using shadcn primitives
      user-form.tsx
      data-table-toolbar.tsx
      ...
  lib/
    utils.ts                 <- cn() utility function
```

### The `cn()` Utility

All class merging uses `cn()` from `@/lib/utils`. This wraps `clsx` + `tailwind-merge` for conflict-free class composition:

```tsx
import { cn } from "@/lib/utils"

// cn() merges classes, resolving Tailwind conflicts correctly
<div className={cn("px-4 py-2", variant === "ghost" && "bg-transparent", className)} />
```

Use `cn()` for all dynamic class merging -- never raw string concatenation.

## Styling Rules

### Semantic Colors Only

All colors reference CSS variable tokens, never raw Tailwind palette colors. Hardcoded colors break theming and dark mode:

```tsx
// Correct -- theme tokens
<p className="text-muted-foreground">Helper text</p>
<div className="bg-card border border-border rounded-lg">...</div>
<span className="text-destructive">Error message</span>

// Wrong -- hardcoded colors
<p className="text-gray-500">Helper text</p>
<div className="bg-white border border-gray-200 rounded-lg">...</div>
<span className="text-red-500">Error message</span>
```

### Spacing: `gap` over `space`

Use `flex gap-*` instead of `space-x-*` / `space-y-*`. Gap works with wrapping, is more predictable, and doesn't add margins to children:

```tsx
// Correct
<div className="flex flex-col gap-4">

// Avoid
<div className="space-y-4">
```

### Size Shorthand

Use `size-*` when width and height are equal:

```tsx
// Correct
<Avatar className="size-10">

// Verbose
<Avatar className="w-10 h-10">
```

### Other Styling Rules

- Use `truncate` as shorthand for text overflow
- Use `className` for layout positioning only -- never override component internal styling
- No manual `dark:` color overrides -- semantic tokens auto-switch in dark mode
- No manual `z-index` on overlay components (Dialog, Sheet, Popover) -- they manage stacking internally
- Use `cn()` for all conditional classes -- never ternary string concatenation

## Component Usage Patterns

### Import Convention

Always import from `@/components/ui/`:

```tsx
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
```

### Variant Props

Most components use `variant` and `size` props powered by `cva` (class-variance-authority):

```tsx
<Button variant="default" />     // primary action
<Button variant="secondary" />   // secondary action
<Button variant="destructive" /> // dangerous action
<Button variant="outline" />     // bordered, no fill
<Button variant="ghost" />       // no border, no fill
<Button variant="link" />        // text-only, underlined

<Button size="default" />  <Button size="sm" />  <Button size="lg" />  <Button size="icon" />
```

Use built-in variants before adding custom styles.

### Extending Components

When you need custom variants, extend the existing component file in `ui/`:

```tsx
// In @/components/ui/button.tsx -- add a new variant
const buttonVariants = cva("...", {
    variants: {
        variant: {
            default: "...",
            success: "bg-success text-success-foreground hover:bg-success/90",  // added — define --success in CSS variables
        },
    },
});
```

Do not create wrapper components just to add a className -- extend the variant system instead.

### The `asChild` Pattern

Many shadcn components support `asChild` (from Radix UI Slot). This renders the child element instead of the default, merging props:

```tsx
// Link that looks like a button
<Button asChild>
    <Link href="/dashboard">Go to Dashboard</Link>
</Button>

// Custom trigger for a dialog
<DialogTrigger asChild>
    <Button variant="outline">Open Settings</Button>
</DialogTrigger>
```

### Icon Patterns

Icons inside shadcn components use the `data-icon` attribute for proper sizing and spacing:

```tsx
// Correct -- data-icon, no sizing classes on the icon
<Button>
    <SearchIcon data-icon="inline-start" />
    Search
</Button>

// Wrong -- manual icon sizing
<Button>
    <SearchIcon className="w-4 h-4 mr-2" />
    Search
</Button>
```

Pass icons as component objects, not string keys. No sizing classes on icons inside shadcn components -- the component handles icon sizing via `data-icon`.

## Component Selection Guide

Before building custom UI, check this table -- shadcn likely has what you need:

| Need | Use |
|------|-----|
| Button/action | `Button` with appropriate variant |
| Form inputs | `Input`, `Select`, `Combobox`, `Switch`, `Checkbox`, `RadioGroup`, `Textarea`, `InputOTP`, `Slider` |
| Toggle 2-5 options | `ToggleGroup` + `ToggleGroupItem` |
| Data display | `Table`, `Card`, `Badge`, `Avatar` |
| Navigation | `Sidebar`, `NavigationMenu`, `Breadcrumb`, `Tabs`, `Pagination` |
| Overlays | `Dialog` (modal), `Sheet` (side panel), `Drawer` (bottom), `AlertDialog` (confirmation) |
| Feedback | `sonner` (toast), `Alert` (callout), `Progress`, `Skeleton` (loading), `Spinner` |
| Command palette | `Command` inside `Dialog` |
| Charts | `ChartContainer` (wraps Recharts) |
| Layout | `Card`, `Separator`, `Resizable`, `ScrollArea`, `Accordion`, `Collapsible` |
| Empty states | `Empty` component |
| Menus | `DropdownMenu`, `ContextMenu`, `Menubar` |
| Tooltips/info | `Tooltip`, `HoverCard`, `Popover` |
| Status/labels | `Badge` with variant (not custom styled spans) |
| Dividers | `Separator` (not `<hr>` or border divs) |

## Accessibility Requirements

These are non-negotiable -- shadcn builds on Radix UI's accessibility:

- `Dialog`, `Sheet`, `Drawer` require `DialogTitle` / `SheetTitle` / `DrawerTitle` -- screen readers need it
- `Avatar` always needs `AvatarFallback` -- displays when image fails to load
- `TabsTrigger` must be inside `TabsList` -- ARIA role hierarchy
- Never remove ARIA attributes or keyboard handlers from shadcn components
- Use `asChild` on triggers (Dialog, Sheet, Tooltip, Popover) when wrapping custom elements -- avoids nested `<button>` violations

## Composition Pattern

Complex UI is built by nesting primitives:

```tsx
// Composed form field with label, input, and error
function FormField({ label, error, ...inputProps }: FormFieldProps) {
    return (
        <div className="space-y-2">
            <Label htmlFor={inputProps.id}>{label}</Label>
            <Input {...inputProps} className={cn(error && "border-destructive")} />
            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    );
}
```

### Button Loading State

Button has no `isPending` or `isLoading` prop -- compose with Spinner:

```tsx
<Button disabled={isPending}>
    {isPending && <Spinner data-icon="inline-start" />}
    {isPending ? "Saving..." : "Save"}
</Button>
```

### Card Composition

Use the full Card composition -- don't skip parts:

```tsx
<Card>
    <CardHeader>
        <CardTitle>Title</CardTitle>
        <CardDescription>Description</CardDescription>
    </CardHeader>
    <CardContent>{/* content */}</CardContent>
    <CardFooter>{/* actions */}</CardFooter>
</Card>
```

## Theming

### CSS Variables

shadcn uses CSS variables for theming. All colors reference semantic tokens:

```css
--background          /* page background */
--foreground          /* default text */
--primary             /* primary actions, buttons */
--primary-foreground  /* text on primary background */
--secondary           /* secondary elements */
--muted               /* subtle backgrounds */
--muted-foreground    /* subtle text (placeholders, hints) */
--accent              /* hover states, highlights */
--destructive         /* error, danger, delete */
--border              /* borders, dividers */
--input               /* input borders */
--ring                /* focus ring */
```

### Dark Mode

shadcn supports dark mode via `.dark` class on `<html>`. When implementing:

- Use semantic CSS variables (auto-switch in dark mode)
- If custom colors needed, define both `:root` and `.dark` variants
- Use `@custom-variant dark (&:is(.dark *))` in Tailwind v4

### Custom Themes

Modify CSS variables in `globals.css`. Use oklch color space (shadcn default since v2):

```css
:root {
    --primary: oklch(0.21 0.006 285.885);
    --primary-foreground: oklch(0.985 0 0);
}
```

Use shadcn themes tool (ui.shadcn.com/themes) to generate palettes.

### Chart Theming

Use `var(--chart-N)` CSS variables for chart colors -- never hardcoded hex values:

```tsx
const chartConfig = {
    desktop: { label: "Desktop", color: "var(--chart-1)" },
    mobile: { label: "Mobile", color: "var(--chart-2)" },
} satisfies ChartConfig;

<Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
```

## Common Component Patterns

### Dialog / Sheet

```tsx
<Dialog>
    <DialogTrigger asChild>
        <Button>Edit Profile</Button>
    </DialogTrigger>
    <DialogContent>
        <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>Make changes to your profile here.</DialogDescription>
        </DialogHeader>
        {/* form content */}
        <DialogFooter>
            <Button type="submit">Save changes</Button>
        </DialogFooter>
    </DialogContent>
</Dialog>
```

Use `Dialog` for focused actions. Use `Sheet` for side panels with more content.

### Form with React Hook Form + Zod

```tsx
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"

const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "" },
});

<Form {...form}>
    <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
            </FormItem>
        )} />
    </form>
</Form>
```

### Data Table with TanStack Table

```tsx
import { ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/ui/data-table"

const columns: ColumnDef<Payment>[] = [
    { accessorKey: "status", header: "Status" },
    { accessorKey: "amount",
      header: () => <div className="text-right">Amount</div>,
      cell: ({ row }) => {
          const formatted = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
              .format(parseFloat(row.getValue("amount")));
          return <div className="text-right font-medium">{formatted}</div>;
      },
    },
];

<DataTable columns={columns} data={payments} />
```

### Sidebar

```tsx
import { SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarMenuItem } from "@/components/ui/sidebar"

<SidebarProvider>
    <Sidebar>
        <SidebarContent>
            <SidebarGroup>
                <SidebarMenuItem>Dashboard</SidebarMenuItem>
            </SidebarGroup>
        </SidebarContent>
    </Sidebar>
    <main>{children}</main>
</SidebarProvider>
```

## CLI Workflow

### Adding Components

```bash
# Search registries before building custom
npx shadcn@latest search @shadcn -q "sidebar"

# Get docs and examples
npx shadcn@latest docs button dialog select

# Preview before adding
npx shadcn@latest add button --dry-run

# Add components
npx shadcn@latest add button card dialog
```

### Safe Update Workflow

When updating components that you've customized:

1. Preview: `npx shadcn@latest add <component> --dry-run`
2. Diff per file: `npx shadcn@latest add <component> --diff <file>`
3. Decide per file based on the diff
4. Never use `--overwrite` without explicit user approval

### Registries

shadcn supports multiple registries: `@shadcn` (official), `@magicui`, `@tailark`, and community presets. Always ask the user which registry when ambiguous.

## Common Pitfalls

- **Missing `cn()` import** -- forgetting to import from `@/lib/utils` when adding dynamic classes
- **Hardcoded colors in custom components** -- `text-gray-500` works in light mode, breaks in dark mode
- **Missing `asChild` on triggers** -- renders an extra button element, causing nested `<button>` HTML violations
- **Overwriting customized `ui/` files** -- `npx shadcn add button` overwrites your variants. Use `--diff` first.
- **Wrong import paths** -- importing from `@radix-ui/react-dialog` directly instead of `@/components/ui/dialog`
- **Sidebar CSS variable conflicts** -- Sidebar uses `--sidebar-*` variables separate from main theme
- **Form validation not showing** -- forgetting `<FormMessage />` inside `<FormField>`
- **DataTable pagination state** -- not controlling pagination externally with server-side pagination
- **Component soup in `ui/`** -- putting business components in `ui/` directory (reserved for shadcn primitives)
- **Wrapping every component** -- creating `MyButton`, `MyInput` wrappers that just pass props (extend variants instead)
- **Mixing Radix UI direct usage with shadcn wrappers** -- pick one per component type
- **Using `onClick` on triggers** -- use `asChild` and put the handler on the child element
- **Static chart colors** -- `fill="#2563eb"` instead of `fill="var(--color-desktop)"` breaks theming

## Context7 Instructions

When looking up shadcn/ui documentation, use these Context7 library identifiers:

- **shadcn/ui:** `/websites/ui_shadcn` -- components, theming, configuration, patterns
- **Radix UI:** `radix-ui/primitives` -- underlying primitives, accessibility, composition API
- **TanStack Table:** `tanstack/table` -- data table patterns, sorting, filtering, pagination
- **Recharts:** `recharts/recharts` -- chart components used by shadcn charts

Always check Context7 for component APIs -- shadcn updates frequently and component props may change between versions.
