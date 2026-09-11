import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Dialog, useConfirm } from './Dialog';

// jsdom has no layout: offsetParent is always null, which the trap uses as
// "visible". Treat every attached element as visible for the test.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    get() {
      return (this as HTMLElement).parentElement;
    },
  });
});

describe('Dialog', () => {
  it('portals, locks scroll, closes on Esc, restores focus and body styles', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    document.body.style.overflow = 'auto';
    const onClose = vi.fn();

    const view = render(
      <Dialog open onClose={onClose} title="T">
        <button>a</button>
        <button>b</button>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('#overlay-root')).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    // First focusable is the close IconButton.
    expect(document.activeElement?.getAttribute('aria-label')).toBeTruthy();

    // Tab wraps: from the last button back to the first focusable.
    const b = screen.getByText('b');
    b.focus();
    fireEvent.keyDown(b, { key: 'Tab' });
    expect(document.activeElement).not.toBe(b);
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    view.rerender(
      <Dialog open={false} onClose={onClose} title="T">
        x
      </Dialog>,
    );
    expect(document.body.style.overflow).toBe('auto');
    expect(document.activeElement).toBe(opener);
  });

  it('keeps the scroll lock while a nested dialog is still open', () => {
    document.body.style.overflow = 'auto';
    const view = render(
      <>
        <Dialog open onClose={() => {}} title="outer">
          x
        </Dialog>
        <Dialog open onClose={() => {}} title="inner">
          y
        </Dialog>
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    view.rerender(
      <>
        <Dialog open={false} onClose={() => {}} title="outer">
          x
        </Dialog>
        <Dialog open onClose={() => {}} title="inner">
          y
        </Dialog>
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('useConfirm resolves with the choice', async () => {
    const { result } = renderHook(() => useConfirm());
    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.confirm({ title: 'Sure?' });
    });
    render(<>{result.current.dialog}</>);
    fireEvent.click(screen.getByText('నిర్ధారించండి'));
    await expect(pending).resolves.toBe(true);
  });
});
