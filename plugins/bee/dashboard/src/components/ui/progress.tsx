import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';

import { cn } from '@/lib/utils';

// Progress — Radix progress primitive with hive-gold indicator.
// The indicator uses translateX to animate the filled width so it respects
// Radix's value semantics (undefined = indeterminate, number = percent).

type ProgressProps = React.ComponentPropsWithoutRef<
  typeof ProgressPrimitive.Root
> & {
  ref?: React.Ref<React.ElementRef<typeof ProgressPrimitive.Root>>;
};

export function Progress({
  ref,
  className,
  value,
  ...props
}: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-none bg-hive-border/40',
        className
      )}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-hive-gold transition-transform"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
