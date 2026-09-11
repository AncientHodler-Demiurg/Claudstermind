import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// HIVE INTELLIGENCE Badge — rectangular tactical indicators.
// Sharp corners, monospace font, uppercase for authority.

export const badgeVariants = cva(
  'inline-flex items-center rounded-none border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider transition-colors',
  {
    variants: {
      variant: {
        default:
          'border-hive-border bg-hive-elevated text-hive-text-secondary',
        success:
          'border-hive-accent/40 bg-hive-accent-dim text-hive-accent',
        warning:
          'border-hive-amber/40 bg-hive-amber-dim text-hive-amber',
        danger:
          'border-hive-danger/40 bg-hive-danger-dim text-hive-danger',
        muted:
          'border-hive-border bg-hive-surface text-hive-muted',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

type BadgeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants> & {
    ref?: React.Ref<HTMLDivElement>;
  };

export function Badge({ ref, className, variant, ...props }: BadgeProps) {
  return (
    <div
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
