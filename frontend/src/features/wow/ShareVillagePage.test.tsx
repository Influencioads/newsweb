import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/public/api', () => ({
  fetchSiteConfig: vi.fn(async () => ({ states: [], districts: [], categories: [] })),
  fetchDistrictMandals: vi.fn(async () => []),
}));
vi.mock('@/features/auth/api', () => ({
  uploadAvatar: vi.fn(),
  updateProfile: vi.fn(),
}));

import { api } from '@/api/client';
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
  it('starts with who is writing: name and photo', () => {
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

  it('needs only a name and photo — the mobile number is optional', () => {
    renderPage();
    fireEvent.change(document.getElementById('sender-name')!, { target: { value: 'రాముడు కొండా' } });
    fireEvent.change(document.getElementById('writer-photo')!, {
      target: { files: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })] },
    });
    // A half-typed number is caught; an empty one is fine.
    fireEvent.change(document.getElementById('sender-phone')!, { target: { value: '98765' } });
    next();
    expect(screen.getByText('10 అంకెల మొబైల్ నంబర్ ఇవ్వండి.')).toBeInTheDocument();
    fireEvent.change(document.getElementById('sender-phone')!, { target: { value: '' } });
    next();
    expect(screen.getByText(/దశ 2 \/ 6/)).toBeInTheDocument();
    expect(document.getElementById('village-name')).toBeInTheDocument();
  });

  it('sends a guest story, its photos and the writer photo in one request', async () => {
    sessionStorage.setItem('wow.village-draft', JSON.stringify({ ...VILLAGE, name: 'రాముడు కొండా', consent: true }));
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 7 } } as never);
    renderPage();
    fireEvent.change(document.getElementById('writer-photo')!, {
      target: { files: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })] },
    });
    for (let i = 0; i < 4; i += 1) next();
    fireEvent.change(document.getElementById('village-photos')!, {
      target: { files: [new File(['x'], 'temple.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /ప్రివ్యూ/ }));
    fireEvent.click(screen.getByRole('button', { name: /కథనం పంపండి/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, form] = post.mock.calls[0]!;
    expect(url).toBe('/public/my-village/submissions');
    const body = form as FormData;
    expect(body.get('name')).toBe('రాముడు కొండా');
    expect(body.getAll('photos')).toHaveLength(1);
    expect(body.get('writer_photo')).toBeInstanceOf(File);
    expect(String(body.get('body_te'))).toContain('మొబైల్: ఇవ్వలేదు');
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
