import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';

import { cn } from '@/lib/utils';

// ScrollArea — Radix scroll area primitive with hive-themed scrollbars.
// The dashboard hosts several long-form panels (task lists, log tails,
// timeline) so every scrollable surface should use this wrapper to get
// consistent scrollbar styling and keyboard behavior.

type ScrollAreaProps = React.ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.Root
> & {
  ref?: React.Ref<React.ElementRef<typeof ScrollAreaPrimitive.Root>>;
};

export function ScrollArea({
  ref,
  className,
  children,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner className="bg-hive-surface" />
    </ScrollAreaPrimitive.Root>
  );
}

type ScrollBarProps = React.ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.ScrollAreaScrollbar
> & {
  ref?: React.Ref<
    React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
  >;
};

export function ScrollBar({
  ref,
  className,
  orientation = 'vertical',
  ...props
}: ScrollBarProps) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      ref={ref}
      orientation={orientation}
      className={cn(
        'flex touch-none select-none transition-colors',
        orientation === 'vertical' &&
          'h-full w-2.5 border-l border-l-transparent p-[1px]',
        orientation === 'horizontal' &&
          'h-2.5 flex-col border-t border-t-transparent p-[1px]',
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-hive-border hover:bg-hive-muted" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
