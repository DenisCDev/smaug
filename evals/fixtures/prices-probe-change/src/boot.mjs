import { build, warm } from './prices.mjs';

export const SUPPORTED_LOCALES = ['pt-br', 'en-us'];

/** Builds one formatter per supported locale before the first request. */
export function boot() {
  warm(SUPPORTED_LOCALES);
  for (const locale of SUPPORTED_LOCALES) build(locale);
}
