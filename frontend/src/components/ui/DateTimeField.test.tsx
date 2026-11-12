import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { DateTimeField } from './DateTimeField';

function Harness({ start = '' }: { start?: string }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <DateTimeField value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe('DateTimeField', () => {
  it('shows a 24-hour value as 12-hour with AM / PM', () => {
    render(<Harness start="2026-11-12T23:45" />);
    expect((screen.getByLabelText('గంట') as HTMLSelectElement).value).toBe('11');
    expect((screen.getByLabelText('నిమిషం') as HTMLSelectElement).value).toBe('45');
    expect((screen.getByLabelText('AM / PM') as HTMLSelectElement).value).toBe('PM');
  });

  it('turns the choices back into the same local value', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('తేదీ'), { target: { value: '2026-11-15' } });
    expect(screen.getByTestId('value').textContent).toBe('2026-11-15T10:00');
    fireEvent.change(screen.getByLabelText('గంట'), { target: { value: '12' } });
    expect(screen.getByTestId('value').textContent).toBe('2026-11-15T00:00');
    fireEvent.change(screen.getByLabelText('AM / PM'), { target: { value: 'PM' } });
    expect(screen.getByTestId('value').textContent).toBe('2026-11-15T12:00');
    fireEvent.change(screen.getByLabelText('నిమిషం'), { target: { value: '30' } });
    expect(screen.getByTestId('value').textContent).toBe('2026-11-15T12:30');
    fireEvent.click(screen.getByText('తొలగించండి'));
    expect(screen.getByTestId('value').textContent).toBe('');
  });
});
