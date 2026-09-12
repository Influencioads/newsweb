import { describe, expect, it } from 'vitest';

import { ADMIN_NAV, findAdminNav, visibleAdminNav } from './adminNav';

describe('adminNav', () => {
  it('resolves editor routes to Articles by longest prefix', () => {
    expect(findAdminNav('/admin/articles/new')?.item.labelKey).toBe('admin.page.articles');
    expect(findAdminNav('/admin/articles/42/edit')?.item.labelKey).toBe('admin.page.articles');
    expect(findAdminNav('/admin/settings')?.group.key).toBe('settings');
    expect(findAdminNav('/admin/nope')).toBeNull();
  });

  it('drops groups whose every item is gated away', () => {
    const groups = visibleAdminNav(() => false);
    expect(groups.map((g) => g.key)).toEqual(['newsroom']);
    expect(visibleAdminNav(() => true)).toHaveLength(ADMIN_NAV.length);
  });
});
