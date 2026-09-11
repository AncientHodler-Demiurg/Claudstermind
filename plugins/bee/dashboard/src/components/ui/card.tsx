import * as React from 'react';

import { cn } from '@/lib/utils';

// HIVE INTELLIGENCE Card primitives — tactical corner-bracket design.
// The "intel-card" CSS class adds corner bracket decorations and hover glow.

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
};

export function Card({ ref, className, ...props }: CardProps) {
  return (
    <div
      ref={ref}
      className={cn(
        'intel-card rounded-sm bg-hive-surface text-hive-text',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ ref, className, ...props }: CardProps) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1 px-5 pt-4 pb-2', className)}
      {...props}
    />
  );
}

type CardTitleProps = React.HTMLAttributes<HTMLHeadingElement> & {
  ref?: React.Ref<HTMLHeadingElement>;
};

export function CardTitle({ ref, className, ...props }: CardTitleProps) {
  return (
    <h3
      ref={ref}
      className={cn(
        'intel-section-title',
        className
      )}
      {...props}
    />
  );
}

type CardDescriptionProps = React.HTMLAttributes<HTMLParagraphElement> & {
  ref?: React.Ref<HTMLParagraphElement>;
};

export function CardDescription({
  ref,
  className,
  ...props
}: CardDescriptionProps) {
  return (
    <p
      ref={ref}
      className={cn('text-xs text-hive-muted font-mono', className)}
      {...props}
    />
  );
}

export function CardContent({ ref, className, ...props }: CardProps) {
  return (
    <div ref={ref} className={cn('px-5 pb-4 pt-0', className)} {...props} />
  );
}

export function CardFooter({ ref, className, ...props }: CardProps) {
  return (
    <div
      ref={ref}
      className={cn('flex items-center px-5 pb-4 pt-0', className)}
      {...props}
    />
  );
}
