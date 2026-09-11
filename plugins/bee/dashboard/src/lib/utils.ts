import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conflict-free Tailwind class merger used by shadcn/ui components.
 * Combines clsx (conditional class composition) with tailwind-merge
 * (resolving conflicting utilities so the last one wins).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
