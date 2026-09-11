import * as React from 'react';

import { cn } from '@/lib/utils';

// Skeleton — lightweight loading placeholder. No Radix dependency; just a
// Tailwind animate-pulse shell tinted with the hive-muted token so it reads
// as a low-emphasis surface while data streams in.

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-none bg-hive-elevated/80 border border-hive-border/30', className)}
      {...props}
    />
  );
}
