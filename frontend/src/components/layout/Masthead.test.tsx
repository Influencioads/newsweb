import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import * as readerApi from '@/features/reader/api';
import { useAuth } from '@/stores/auth';
import { useReaderPrefs } from '@/stores/readerPrefs';

import { Masthead } from './Masthead';

const { never } = vi.hoisted(() => ({ never: () => new Promise<never>(() => {}) }));

vi.mock('@/features/public/api', () => ({
  fetchSiteConfig: vi.fn(async () => ({
    categories: [],
    states: [
      { code: 'AP', slug: 'andhra-pradesh', name_te: 'ఆంధ్రప్రదేశ్', name_en: 'Andhra Pradesh' },
      { code: 'TG', slug: 'telangana', name_te: 'తెలంగాణ', name_en: 'Telangana' },
    ],
    districts: [
      { slug: 'guntur', name_te: 'గుంటూరు', name_en: 'Guntur', state: 'AP' },
      { slug: 'hyderabad', name_te: 'హైదరాబాద్', name_en: 'Hyderabad', state: 'TG' },
    ],
  })),
  fetchDistrictMandals: vi.fn(async () => []),
}));

vi.mock('@/features/engagement/notificationsApi', () => ({
  fetchInbox: vi.fn(async () => ({ unread: 0, items: [], next_offset: null })),
}));

vi.mock('@/features/reader/api', () => ({ updatePreferences: vi.fn(async () => ({})) }));

function renderMasthead() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Masthead />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function chooseGuntur() {
  fireEvent.click(screen.getByRole('button', { name: 'ప్రాంతం ఎంచుకోండి' }));
  const dialog = screen.getByRole('dialog');
  const district = within(dialog).getByRole('combobox', { name: /జిల్లా/ });
  await within(district).findByRole('option', { name: 'గుంటూరు' });
  fireEvent.change(district, { target: { value: 'guntur' } });
  return dialog;
}

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(never);
  vi.mocked(readerApi.updatePreferences).mockClear();
  useReaderPrefs.setState({ edition: null, mandal: null, locality: null });
  useAuth.setState({ status: 'anonymous', me: null });
});

describe('Masthead location', () => {
  it('applies the reader’s pick at once, names it on the button, and syncs nothing when signed out', async () => {
    renderMasthead();
    const dialog = await chooseGuntur();

    expect(useReaderPrefs.getState().edition).toBe('guntur');
    fireEvent.click(within(dialog).getByRole('button', { name: 'పూర్తయింది' }));
    expect(await screen.findByRole('button', { name: 'మీ ప్రాంతం: గుంటూరు' })).toBeInTheDocument();
    expect(readerApi.updatePreferences).not.toHaveBeenCalled();
  });

  it('mirrors a signed-in reader’s pick to their server preferences', async () => {
    useAuth.setState({
      status: 'authenticated',
      me: { user: { name_te: 'పాఠకుడు', name_en: 'Reader' } } as never,
    });
    renderMasthead();
    await chooseGuntur();

    expect(readerApi.updatePreferences).toHaveBeenCalledWith({
      district_slug: 'guntur',
      mandal_slug: null,
      locality_slug: null,
    });
  });

  it('follows a district another picker chose, even after a state was picked here', async () => {
    renderMasthead();
    fireEvent.click(screen.getByRole('button', { name: 'ప్రాంతం ఎంచుకోండి' }));
    const dialog = screen.getByRole('dialog');
    const state = within(dialog).getByRole('combobox', { name: /రాష్ట్రం/ });
    await within(state).findByRole('option', { name: 'తెలంగాణ' });
    fireEvent.change(state, { target: { value: 'TG' } });
    const district = within(dialog).getByRole('combobox', { name: /జిల్లా/ });
    fireEvent.change(district, { target: { value: 'hyderabad' } });
    expect(useReaderPrefs.getState().edition).toBe('hyderabad');

    // The Local page (or reader settings) moves the reader to Guntur.
    act(() => useReaderPrefs.getState().setEdition('guntur'));

    expect(state).toHaveValue('AP');
    expect(district).toHaveValue('guntur');
  });
});
