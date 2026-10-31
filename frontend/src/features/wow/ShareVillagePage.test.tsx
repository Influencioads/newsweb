import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/public/api', () => ({
  fetchSiteConfig: vi.fn(async () => ({ states: [], districts: [], categories: [] })),
  fetchDistrictMandals: vi.fn(async () => []),
}));

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

beforeEach(() => sessionStorage.clear());

describe('Share Your Village', () => {
  it('starts at village details and will not move on without them', () => {
    renderPage();
    expect(screen.getByText(/దశ 1 \/ 6/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /తర్వాత/ }));
    expect(screen.getByText('గ్రామం పేరు రాయండి.')).toBeInTheDocument();
    expect(screen.getByText(/దశ 1 \/ 6/)).toBeInTheDocument();
  });

  it('keeps the draft and resumes on the specialities step once details are filled', () => {
    sessionStorage.setItem(
      'wow.village-draft',
      JSON.stringify({ village: 'పెదపూడి', state: 'AP', district: 'east-godavari', mandal: 'pedapudi' }),
    );
    renderPage();
    expect(screen.getByDisplayValue('పెదపూడి')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /తర్వాత/ }));
    expect(screen.getByText(/దశ 2 \/ 6/)).toBeInTheDocument();
    // Specialities: at least one is needed, and choosing one lets the reader on.
    fireEvent.click(screen.getByRole('button', { name: /తర్వాత/ }));
    expect(screen.getByText('కనీసం ఒక అంశం ఎంచుకోండి.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /గ్రామ చరిత్ర/ }));
    fireEvent.click(screen.getByRole('button', { name: /తర్వాత/ }));
    expect(screen.getByText(/దశ 3 \/ 6/)).toBeInTheDocument();
  });

  it('asks who is writing: name and photo are needed before the preview', () => {
    sessionStorage.setItem(
      'wow.village-draft',
      JSON.stringify({
        village: 'పెదపూడి',
        state: 'AP',
        district: 'east-godavari',
        mandal: 'pedapudi',
        specialities: ['history'],
        story: 'మా ఊరి కథ '.repeat(20),
        phone: '9876543210',
        consent: true,
      }),
    );
    URL.createObjectURL = vi.fn(() => 'blob:writer');
    URL.revokeObjectURL = vi.fn();
    renderPage();
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByRole('button', { name: /తర్వాత/ }));
    expect(screen.getByText(/దశ 5 \/ 6/)).toBeInTheDocument();
    expect(screen.getByText('ఈ కథ రాస్తున్నది ఎవరు?')).toBeInTheDocument();

    fireEvent.change(document.getElementById('sender-name')!, { target: { value: 'రాముడు కొండా' } });
    fireEvent.click(screen.getByRole('button', { name: /ప్రివ్యూ/ }));
    expect(screen.getByText('మీ ఫొటో జోడించండి.')).toBeInTheDocument();
    expect(screen.getByText(/దశ 5 \/ 6/)).toBeInTheDocument();

    const photo = new File(['x'], 'me.jpg', { type: 'image/jpeg' });
    fireEvent.change(document.getElementById('writer-photo')!, { target: { files: [photo] } });
    expect(screen.getAllByAltText('మీ ఫొటో')[0]).toHaveAttribute('src', 'blob:writer');
    fireEvent.click(screen.getByRole('button', { name: /ప్రివ్యూ/ }));
    expect(screen.getByText(/దశ 6 \/ 6/)).toBeInTheDocument();
    expect(screen.getByText('రాముడు కొండా')).toBeInTheDocument();
  });
});
