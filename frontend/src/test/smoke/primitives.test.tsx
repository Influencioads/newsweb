import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bell } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/client';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Field, Input, Switch } from '@/components/ui/Field';
import { QueryState } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { Toaster } from '@/components/ui/Toast';
import { useToastStore } from '@/stores/toast';

describe('Button family', () => {
  it('Button meets the 44px floor', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveClass('min-h-tap');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('pending sets aria-busy and disables', () => {
    render(<Button pending>Save</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
  });

  it('IconButton is a 44px square whose accessible name carries the badge count', () => {
    render(<IconButton icon={Bell} label="Alerts" badge={120} />);
    const btn = screen.getByRole('button', { name: 'Alerts (99+)' });
    expect(btn).toHaveClass('h-tap', 'w-tap');
    expect(btn).toHaveAttribute('title', 'Alerts');
    expect(btn).toHaveTextContent('99+');
  });
});

describe('Dialog', () => {
  it('portals into #overlay-root, traps focus, closes on Esc and restores focus', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();

    const view = render(
      <Dialog open onClose={onClose} title="Settings">
        <button>inside</button>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('#overlay-root')).not.toBeNull();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Settings');
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    view.rerender(
      <Dialog open={false} onClose={onClose} title="Settings">
        x
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('ConfirmDialog calls onConfirm', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onClose={() => {}} onConfirm={onConfirm} title="Sure?" confirmLabel="Yes" />);
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('store pushes, caps at three and dismisses', () => {
    const { push, dismiss } = useToastStore.getState();
    const first = push('info', 'one');
    push('info', 'two');
    push('info', 'three');
    push('error', 'four');
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['two', 'three', 'four']);
    dismiss(first);
    const second = useToastStore.getState().toasts[0]!.id;
    dismiss(second);
    expect(useToastStore.getState().toasts).toHaveLength(2);
  });

  it('Toaster renders one polite live region (no per-toast status) and auto-dismisses', () => {
    render(<Toaster />);
    act(() => {
      useToastStore.getState().push('success', 'Saved');
    });
    const region = screen.getByRole('region');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.closest('#overlay-root')).not.toBeNull();
    expect(region).toHaveTextContent('Saved');
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('tags a Telugu message with lang="te" even when pushed outside React', () => {
    render(<Toaster />);
    act(() => {
      useToastStore.getState().push('error', 'తప్పు జరిగింది');
    });
    const msg = screen.getByText('తప్పు జరిగింది');
    expect(msg).toHaveAttribute('lang', 'te');
    expect(msg).toHaveClass('te');
  });
});

describe('Tabs', () => {
  it('ArrowRight moves selection and focus', () => {
    const onChange = vi.fn();
    const items = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ];
    render(<Tabs items={items} value="a" onChange={onChange} ariaLabel="Sections" />);
    const [a, b] = screen.getAllByRole('tab');
    expect(a).toHaveAttribute('aria-selected', 'true');
    expect(b).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(a!, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
    expect(document.activeElement).toBe(b);
  });
});

describe('Field family', () => {
  it('Switch exposes role=switch and toggles', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Dark mode" />);
    const sw = screen.getByRole('switch', { name: 'Dark mode' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Field wires label, hint and error onto the control', () => {
    render(
      <Field label="Headline" hint="Keep it short" error="Required">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText(/Headline/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Required Keep it short');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
});

describe('Chip / Badge', () => {
  it('ChipRail renders its chips as a named group', () => {
    render(
      <ChipRail ariaLabel="Filters">
        <Chip selected>All</Chip>
        <Chip>Sports</Chip>
      </ChipRail>,
    );
    expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sports' })).toHaveClass('min-h-tap', 'rounded-pill');
  });

  it.each<[BadgeTone, string]>([
    ['brand', 'bg-brand-tint'],
    ['breaking', 'bg-breaking'],
    ['exclusive', 'bg-exclusive-tint'],
    ['ai', 'bg-ai-tint'],
    ['success', 'bg-success-tint'],
    ['info', 'bg-info-tint'],
    ['partial', 'bg-partial-tint'],
    ['muted', 'bg-rule-soft'],
    ['district', 'bg-paper-sub'],
  ])('Badge tone %s uses its token', (tone, cls) => {
    render(<Badge tone={tone}>x</Badge>);
    expect(screen.getByText('x')).toHaveClass(cls, 'rounded-pill');
  });
});

describe('QueryState', () => {
  const base = { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  const child = (d: string[]) => <ul>{d.map((x) => <li key={x}>{x}</li>)}</ul>;

  it('loading → status + skeleton', () => {
    render(<QueryState query={{ ...base, isLoading: true }}>{child}</QueryState>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('data → children', () => {
    render(<QueryState query={{ ...base, data: ['one'] }}>{child}</QueryState>);
    expect(screen.getByRole('listitem')).toHaveTextContent('one');
  });

  it('error → alert with ApiError copy and retry', async () => {
    const refetch = vi.fn();
    const error = new ApiError(500, { code: 'X', message_en: 'Boom', message_te: 'తప్పు' });
    render(<QueryState query={{ ...base, isError: true, error, refetch }}>{child}</QueryState>);
    expect(screen.getByRole('alert')).toHaveTextContent('తప్పు');
    await userEvent.click(screen.getByRole('button'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('empty array → empty state', () => {
    render(<QueryState query={{ ...base, data: [] }}>{child}</QueryState>);
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.getByRole('heading')).toHaveTextContent('ఇక్కడ ఇంకా ఏమీ లేదు');
  });
});
