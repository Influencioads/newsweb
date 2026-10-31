import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/public/api', () => ({
  fetchSiteConfig: vi.fn(async () => ({ states: [], districts: [], categories: [] })),
  fetchDistrictMandals: vi.fn(async () => []),
}));
vi.mock('@/features/auth/api', () => ({
  requestOtp: vi.fn(async () => ({ sent: true, expires_in_seconds: 300, dev_otp: null })),
  uploadAvatar: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock('@/features/reader/api', () => ({
  verifyReaderOtp: vi.fn(async () => ({
    is_new_account: true,
    me: { user: { name_te: '', name_en: '', phone: '9876543210', phone_verified_at: '2026-10-31T00:00:00Z', avatar_url: null } },
  })),
}));

import * as authApi from '@/features/auth/api';
import { useAuth } from '@/stores/auth';

import ShareVillagePage from './ShareVillagePage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ShareVillagePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SIGNED_IN = {
  status: 'authenticated' as const,
  me: {
    user: { name_te: 'రాముడు కొండా', name_en: 'Ramudu', phone: '9876543210', phone_verified_at: '2026-10-01T00:00:00Z', avatar_url: '/me.jpg' },
  } as never,
};

const VILLAGE = {
  village: 'పెదపూడి',
  state: 'AP',
  district: 'east-godavari',
  mandal: 'pedapudi',
  specialities: ['history'],
  story: 'మా ఊరి కథ '.repeat(20),
};

const next = () => fireEvent.click(screen.getByRole('button', { name: /తర్వాత/ }));

beforeEach(() => {
  sessionStorage.clear();
  useAuth.setState({ status: 'anonymous', me: null });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

describe('Share Your Village', () => {
  it('starts with who is writing: name, photo and a verified mobile', () => {
    renderPage();
    expect(screen.getByText(/దశ 1 \/ 6/)).toBeInTheDocument();
    expect(screen.getByText('ఈ కథ రాస్తున్నది ఎవరు?')).toBeInTheDocument();
    next();
    expect(screen.getByText('మీ పూర్తి పేరు రాయండి.')).toBeInTheDocument();
    expect(screen.getByText('మీ ఫొటో జోడించండి.')).toBeInTheDocument();
    expect(screen.getByText(/దశ 1 \/ 6/)).toBeInTheDocument();
    // No sign-in page anywhere in the flow.
    expect(screen.queryByText(/సైన్ ఇన్/)).not.toBeInTheDocument();
  });

  it('verifies the mobile with an OTP right on the page, then moves on to the village', async () => {
    renderPage();
    fireEvent.change(document.getElementById('sender-name')!, { target: { value: 'రాముడు కొండా' } });
    fireEvent.change(document.getElementById('writer-photo')!, {
      target: { files: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.change(document.getElementById('sender-phone')!, { target: { value: '9876543210' } });
    next();
    expect(screen.getByText('OTP తో మొబైల్ నంబర్ ధృవీకరించండి.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /OTP పంపండి/ }));
    await waitFor(() => expect(authApi.requestOtp).toHaveBeenCalledWith('9876543210'));
    const firstBox = await screen.findByLabelText('OTP 1');
    fireEvent.change(firstBox, { target: { value: '123456' } });
    await screen.findByText('ధృవీకరించబడింది');

    next();
    expect(screen.getByText(/దశ 2 \/ 6/)).toBeInTheDocument();
    expect(document.getElementById('village-name')).toBeInTheDocument();
  });

  it('a verified reader with a profile photo goes straight through to the specialities', () => {
    useAuth.setState(SIGNED_IN);
    sessionStorage.setItem('wow.village-draft', JSON.stringify({ village: 'పెదపూడి', state: 'AP', district: 'east-godavari', mandal: 'pedapudi' }));
    renderPage();
    expect(screen.getByDisplayValue('రాముడు కొండా')).toBeInTheDocument();
    next();
    expect(screen.getByText(/దశ 2 \/ 6/)).toBeInTheDocument();
    next();
    expect(screen.getByText(/దశ 3 \/ 6/)).toBeInTheDocument();
    next();
    expect(screen.getByText('కనీసం ఒక అంశం ఎంచుకోండి.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /గ్రామ చరిత్ర/ }));
    next();
    expect(screen.getByText(/దశ 4 \/ 6/)).toBeInTheDocument();
  });

  it('lets the writer choose village photos with no sign-in prompt', () => {
    useAuth.setState(SIGNED_IN);
    sessionStorage.setItem('wow.village-draft', JSON.stringify(VILLAGE));
    renderPage();
    for (let i = 0; i < 4; i += 1) next();
    expect(screen.getByText(/దశ 5 \/ 6/)).toBeInTheDocument();
    fireEvent.change(document.getElementById('village-photos')!, {
      target: { files: [new File(['x'], 'temple.jpg', { type: 'image/jpeg' })] },
    });
    expect(screen.getByText(/ఫొటోలు ఎంచుకోండి/)).toHaveTextContent('(1/5)');
  });

  it('asks for the consent on the preview before sending', () => {
    useAuth.setState(SIGNED_IN);
    sessionStorage.setItem('wow.village-draft', JSON.stringify(VILLAGE));
    renderPage();
    for (let i = 0; i < 4; i += 1) next();
    fireEvent.click(screen.getByRole('button', { name: /ప్రివ్యూ/ }));
    expect(screen.getByText(/దశ 6 \/ 6/)).toBeInTheDocument();
    expect(screen.getByText('రాముడు కొండా')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /కథనం పంపండి/ }));
    expect(screen.getByText('అనుమతి ధృవీకరణ అవసరం.')).toBeInTheDocument();
  });
});
