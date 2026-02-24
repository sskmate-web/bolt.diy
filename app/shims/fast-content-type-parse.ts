// app/shims/fast-content-type-parse.ts
import * as mod from 'fast-content-type-parse';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m: any = (mod as any)?.default ?? mod;

export const parse =
  m?.parse ??
  ((..._args: unknown[]) => {
    throw new Error('fast-content-type-parse.parse is not available at runtime');
  });

export const safeParse =
  m?.safeParse ??
  ((..._args: unknown[]) => {
    throw new Error('fast-content-type-parse.safeParse is not available at runtime');
  });

export default m;