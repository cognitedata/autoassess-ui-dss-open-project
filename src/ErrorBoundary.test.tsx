import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Boom');
  return <div>Safe content</div>;
}

describe(ErrorBoundary.name, () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Child content')).toBeDefined();
  });

  it('renders an error alert when a child throws', () => {
    // Suppress the expected React error-boundary console.error noise for this test
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/Something went wrong: Boom/)).toBeDefined();
  });

  it('recovers and renders children again after clicking "Try again"', async () => {
    // Arrange: mount with a throwing child so the boundary catches and shows the fallback
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeDefined();

    // Act: swap in a non-throwing child, then click "Try again" to reset the boundary's state
    rerender(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    // Assert
    expect(screen.getByText('Safe content')).toBeDefined();
  });
});
