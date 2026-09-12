import { useI18n } from '@/i18n';

/**
 * `const L = useL(); L(te, en)` — inline bilingual copy for CMS chrome that has
 * no `strings.ts` key yet. One definition; the section `shared` modules re-export it.
 */
export function useL(): (te: string, en: string) => string {
  const { language } = useI18n();
  return (te, en) => (language === 'te' ? te : en);
}
