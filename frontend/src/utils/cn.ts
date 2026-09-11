import { clsx, type ClassValue } from 'clsx';

/**
 * Class-name joiner. Replaces the `[...].join(' ')` arrays and template
 * ternaries scattered through the components; falsy values drop out.
 *
 *     cn('rounded-xl', selected && 'bg-brand', { 'opacity-50': disabled })
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export type { ClassValue };
