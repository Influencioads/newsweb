import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Input, Textarea, TeluguTypingContext } from './Field';

function Form({ on }: { on: boolean }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  return (
    <TeluguTypingContext.Provider value={on}>
      <Input aria-label="title" script="te" value={a} onChange={(e) => setA(e.target.value)} />
      <Textarea aria-label="body" script="te" value={b} onChange={(e) => setB(e.target.value)} />
    </TeluguTypingContext.Provider>
  );
}

/** Google's reply shape: ["SUCCESS", [[word, [candidates…]]]]. */
function google(answers: Record<string, string>) {
  vi.stubGlobal('fetch', async (url: string) => {
    const word = new URL(url).searchParams.get('text') ?? '';
    return new Response(JSON.stringify(['SUCCESS', [[word, [answers[word]]]]]));
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('phonetic Telugu typing', () => {
  it("takes Google's spelling on space and on blur", async () => {
    google({ namaskaram: 'నమస్కారం', hyderabad: 'హైదరాబాద్' });
    render(<Form on />);
    const title = screen.getByLabelText('title');
    await userEvent.type(title, 'namaskaram ');
    await waitFor(() => expect(title).toHaveValue('నమస్కారం '));
    // user-event keeps its own copy of the value, so it cannot keep typing
    // after our programmatic swap; the blur path gets a fresh field instead.
    const body = screen.getByLabelText('body');
    await userEvent.type(body, 'hyderabad');
    await userEvent.click(title);
    await waitFor(() => expect(body).toHaveValue('హైదరాబాద్'));
  });

  it('falls back to the rule table when Google is unreachable', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    render(<Form on />);
    const body = screen.getByLabelText('body');
    await userEvent.type(body, 'raamu,');
    await waitFor(() => expect(body).toHaveValue('రాము,'));
  });

  it('leaves text alone on English', async () => {
    render(<Form on={false} />);
    await userEvent.type(screen.getByLabelText('title'), 'telugu ');
    expect(screen.getByLabelText('title')).toHaveValue('telugu ');
  });
});
