import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLanguage } from '@/i18n';

import { ReportCard, type ReportRow } from './ModerationCards';

/**
 * The takedown button is a permission gate, not a style choice: `moderator`
 * does not hold `article.unpublish`, and a control that always 403s teaches
 * people to ignore permission errors. That branch is what this covers.
 */

const ARTICLE_REPORT: ReportRow = {
  id: 1,
  reason: 'misinformation',
  note: null,
  status: 'open',
  created_at: '2026-09-18T10:00:00Z',
  resolution_note: null,
  report_count: 3,
  target: { kind: 'article', id: 42, title_te: 'పరీక్ష కథనం', short_id: 'ab12cd', url: '/news/x-ab12cd' },
};

function renderCard(canUnpublish: boolean, report: ReportRow = ARTICLE_REPORT) {
  return render(
    <ReportCard
      report={report}
      busy={null}
      canUnpublish={canUnpublish}
      onHide={vi.fn()}
      onUnpublish={vi.fn()}
      onResolve={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
}

describe('ReportCard', () => {
  beforeEach(() => {
    act(() => useLanguage.setState({ language: 'en' }));
  });

  it('offers Unpublish on an article only to someone who holds the permission', () => {
    const { unmount } = renderCard(true);
    expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
    unmount();

    renderCard(false);
    expect(screen.queryByRole('button', { name: 'Unpublish' })).not.toBeInTheDocument();
  });

  it('never offers Unpublish on a comment report, permission or not', () => {
    renderCard(true, {
      ...ARTICLE_REPORT,
      target: { kind: 'comment', id: 7, body: 'spam', status: 'visible', author: 'R' },
    });
    expect(screen.queryByRole('button', { name: 'Unpublish' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide comment' })).toBeInTheDocument();
  });

  it('says how many open reports share this target, and stays quiet about one', () => {
    const { unmount } = renderCard(true);
    expect(screen.getByText('3 reports')).toBeInTheDocument();
    unmount();

    renderCard(true, { ...ARTICLE_REPORT, report_count: 1 });
    expect(screen.queryByText(/reports$/)).not.toBeInTheDocument();
  });
});
