import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SelfieCamera } from './SelfieCamera';

const original = navigator.mediaDevices;
afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { value: original, configurable: true });
});

describe('SelfieCamera', () => {
  it('asks for the front camera and shows the shutter once it is live', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    HTMLMediaElement.prototype.play = vi.fn(async () => undefined);

    render(<SelfieCamera open onClose={() => undefined} onCapture={() => undefined} />);
    expect(await screen.findByRole('button', { name: /ఫొటో తీయండి/ })).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: 'user' }) }));
  });

  it('falls back to the phone camera / file picker when the camera cannot open', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(async () => Promise.reject(new Error('denied'))) },
      configurable: true,
    });
    const onCapture = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<SelfieCamera open onClose={onClose} onCapture={onCapture} />);
    expect(await screen.findByRole('button', { name: /ఫొటో తీయండి \/ ఎంచుకోండి/ })).toBeInTheDocument();

    const input = document.body.querySelector('input[capture="user"]') ?? container.querySelector('input[capture="user"]');
    expect(input).not.toBeNull();
    const photo = new File(['x'], 'me.jpg', { type: 'image/jpeg' });
    fireEvent.change(input!, { target: { files: [photo] } });
    expect(onCapture).toHaveBeenCalledWith(photo);
    expect(onClose).toHaveBeenCalled();
  });
});
