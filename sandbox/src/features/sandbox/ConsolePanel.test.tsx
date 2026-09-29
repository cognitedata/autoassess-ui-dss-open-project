import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConsolePanel } from './ConsolePanel';

describe(ConsolePanel.name, () => {
  it('should show a placeholder when empty and disable Clear', () => {
    render(<ConsolePanel chunks={[]} onClear={vi.fn()} />);

    expect(screen.getByRole('log')).toHaveTextContent('Output of your script appears here');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('should render chunks styled by stream', () => {
    render(
      <ConsolePanel
        chunks={[
          { id: 1, stream: 'stdout', text: 'ok\n' },
          { id: 2, stream: 'error', text: 'ValueError: boom\n' },
        ]}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText('ValueError: boom')).toHaveClass('console-error');
  });

  it('should call onClear', async () => {
    const onClear = vi.fn();
    render(<ConsolePanel chunks={[{ id: 1, stream: 'stdout', text: 'x' }]} onClear={onClear} />);

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onClear).toHaveBeenCalled();
  });
});
