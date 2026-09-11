---
name: storybook
description: "Storybook component documentation -- stories, args, controls, decorators, testing. Use when project has storybook or @storybook/* in package.json."
---

# Storybook Standards

**Detection:** Check `package.json` for `storybook` or `@storybook/*`. Check for `.storybook/` directory. If absent, skip.

## Story Format (CSF3)

```typescript
// Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['default', 'destructive', 'outline', 'ghost'] },
    size: { control: 'select', options: ['default', 'sm', 'lg', 'icon'] },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: 'Button', variant: 'default' },
};

export const Destructive: Story = {
  args: { children: 'Delete', variant: 'destructive' },
};

export const Loading: Story = {
  args: { children: 'Saving...', disabled: true },
};
```

## Story Organization

```
src/
  components/
    ui/
      Button.tsx
      Button.stories.tsx     # co-located with component
    custom/
      OrderCard.tsx
      OrderCard.stories.tsx
  pages/
    Dashboard.tsx
    Dashboard.stories.tsx
```

Organize in Storybook sidebar: `title: 'UI/Button'`, `title: 'Features/OrderCard'`, `title: 'Pages/Dashboard'`.

## Decorators

```typescript
// .storybook/preview.tsx — global decorators
const preview: Preview = {
  decorators: [
    (Story) => (
      <ThemeProvider>
        <div style={{ padding: '1rem' }}>
          <Story />
        </div>
      </ThemeProvider>
    ),
  ],
};
```

## Interaction Tests

```typescript
import { expect, userEvent, within } from '@storybook/test';

export const FilledForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Email'), 'user@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Submit' }));
    await expect(canvas.getByText('Success')).toBeInTheDocument();
  },
};
```

## Rules

- **Co-locate stories with components** — `Button.stories.tsx` next to `Button.tsx`
- **Use CSF3 format** (Component Story Format 3) — `satisfies Meta`, `StoryObj`
- **Tag with `autodocs`** — generates documentation page automatically
- **Cover all variants** — one story per meaningful state (default, loading, error, empty, disabled)
- **Interaction tests for complex components** — forms, dialogs, multi-step flows

## Common Pitfalls

- **Stories not co-located** — stories in separate `__stories__/` directory lose component context
- **Missing decorators** — components that need providers (theme, router) render broken without decorators
- **No `satisfies Meta`** — loses type checking on args. Always use `satisfies Meta<typeof Component>`
- **Testing visual state only** — interaction tests verify behavior, not just appearance
