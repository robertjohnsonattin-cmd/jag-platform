// JAG Platform i18n utility
// Supported locales: en (default), zh (Mandarin — wife's default), es (DragonBridge customer-facing only)
// Rule: manual translation for financial/legal/compliance/alert strings.
//       Machine translation acceptable for navigation only.
//
// Usage:
//   import { t, tNotification } from '../i18n';
//   t('errors.UNAUTHORIZED', 'zh')
//   tNotification('tier1.BACKUP_FAILED', 'zh', { time: '02:00' })

import { en_common, type LocaleCommon } from './en/common';
import { zh_common } from './zh/common';

export type SupportedLocale = 'en' | 'zh' | 'es';

const locales: Record<'en' | 'zh', LocaleCommon> = {
  en: en_common,
  zh: zh_common,
};

// Resolve a dot-path string against an object, returning the leaf value or the fallback.
function resolvePath(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

// Replace {{placeholder}} tokens in a string.
function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? `{{${key}}}`);
}

/**
 * Translate a dot-path key for a given locale.
 * Falls back to English if the key is missing in the requested locale.
 * Falls back to the raw key string if missing in English too (never throws).
 */
export function t(
  key: string,
  locale: SupportedLocale = 'en',
  params?: Record<string, string>,
): string {
  const localeObj = locales[locale as 'en' | 'zh'] ?? locales.en;
  const raw =
    resolvePath(localeObj as unknown as Record<string, unknown>, key) ??
    resolvePath(locales.en as unknown as Record<string, unknown>, key) ??
    key;
  return params ? interpolate(raw, params) : raw;
}

/**
 * Translate a notification (returns { title, body } object).
 * Notification keys are under notifications.tier1.KEY, notifications.tier2.KEY, etc.
 */
export function tNotification(
  tierAndKey: string,            // e.g. 'tier1.BACKUP_FAILED'
  locale: SupportedLocale = 'en',
  params?: Record<string, string>,
): { title: string; body: string } {
  return {
    title: t(`notifications.${tierAndKey}.title`, locale, params),
    body:  t(`notifications.${tierAndKey}.body`,  locale, params),
  };
}

/**
 * Resolve the preferred locale from a user's stored preference string.
 * Falls back to 'en' for any unrecognised value.
 */
export function resolveLocale(preference: string | null | undefined): SupportedLocale {
  if (preference === 'zh' || preference === 'es') return preference;
  return 'en';
}

export type { LocaleCommon } from './en/common';
