import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';

import { createMockDroneImage } from '../../__mocks__/droneImages';
import { UseDroneImagesContext } from '../viewer/useDroneImages';
import type { UseDroneImagesDeps } from '../viewer/useDroneImages';
import { ImageLightbox } from './ImageLightbox';

const IMAGE_URL = 'https://image.test/frame.jpg';

describe(ImageLightbox.name, () => {
  let mockUseCogniteSdk: ReturnType<typeof vi.fn>;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    const mockSdk = {
      files: {
        getDownloadUrls: vi.fn().mockResolvedValue([{ downloadUrl: IMAGE_URL }]),
      },
    };
    mockUseCogniteSdk = vi.fn(() => mockSdk);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          UseDroneImagesContext.Provider,
          { value: { useCogniteSdk: mockUseCogniteSdk } as UseDroneImagesDeps },
          children,
        ),
      );
  });

  it('should render the dialog', () => {
    const image = createMockDroneImage();
    render(
      <ImageLightbox image={image} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />,
      { wrapper },
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should show the frame ID in the caption', () => {
    const image = createMockDroneImage({ frameId: 7 });
    render(
      <ImageLightbox image={image} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />,
      { wrapper },
    );
    expect(screen.getByText('Frame 7')).toBeInTheDocument();
  });

  it('should show a formatted timestamp in the caption', () => {
    // timestamp 0 → 1 Jan 1970 · 00:00 UTC
    const image = createMockDroneImage({ timestamp: 0 });
    render(
      <ImageLightbox image={image} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />,
      { wrapper },
    );
    expect(screen.getByText(/1 Jan 1970/)).toBeInTheDocument();
    expect(screen.getByText(/UTC/)).toBeInTheDocument();
  });

  it('should show previous and next buttons when both callbacks are provided', () => {
    const image = createMockDroneImage();
    render(
      <ImageLightbox image={image} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: 'Previous image' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next image' })).not.toBeDisabled();
  });

  it('should disable the Previous button when onPrev is null', () => {
    const image = createMockDroneImage();
    render(
      <ImageLightbox image={image} onClose={vi.fn()} onPrev={null} onNext={vi.fn()} />,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: 'Previous image' })).toBeDisabled();
  });

  it('should disable the Next button when onNext is null', () => {
    const image = createMockDroneImage();
    render(
      <ImageLightbox image={image} onClose={vi.fn()} onPrev={vi.fn()} onNext={null} />,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: 'Next image' })).toBeDisabled();
  });

  it('should call onClose when the Close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const image = createMockDroneImage();
    render(
      <ImageLightbox image={image} onClose={onClose} onPrev={vi.fn()} onNext={vi.fn()} />,
      { wrapper },
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('should call onClose when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const image = createMockDroneImage();
    render(
      <ImageLightbox image={image} onClose={onClose} onPrev={vi.fn()} onNext={vi.fn()} />,
      { wrapper },
    );
    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });

  it('should call onClose when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const image = createMockDroneImage();
    render(
      <ImageLightbox image={image} onClose={onClose} onPrev={vi.fn()} onNext={vi.fn()} />,
      { wrapper },
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('should call onPrev when ArrowLeft is pressed', async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const image = createMockDroneImage();
    render(
      <ImageLightbox image={image} onClose={vi.fn()} onPrev={onPrev} onNext={vi.fn()} />,
      { wrapper },
    );
    await user.keyboard('{ArrowLeft}');
    expect(onPrev).toHaveBeenCalled();
  });

  it('should call onNext when ArrowRight is pressed', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const image = createMockDroneImage();
    render(
      <ImageLightbox image={image} onClose={vi.fn()} onPrev={vi.fn()} onNext={onNext} />,
      { wrapper },
    );
    await user.keyboard('{ArrowRight}');
    expect(onNext).toHaveBeenCalled();
  });

  it('should not call onPrev when ArrowLeft is pressed and onPrev is null', async () => {
    const user = userEvent.setup();
    const image = createMockDroneImage();
    // No assertion needed — just ensure no error is thrown
    render(
      <ImageLightbox image={image} onClose={vi.fn()} onPrev={null} onNext={vi.fn()} />,
      { wrapper },
    );
    await user.keyboard('{ArrowLeft}');
    // reaches here without error
  });

  it('should render "View in 3D viewer" button when onViewIn3D is provided', () => {
    const image = createMockDroneImage();
    render(
      <ImageLightbox image={image} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} onViewIn3D={vi.fn()} />,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: /view in 3d viewer/i })).toBeInTheDocument();
  });

  it('should not render "View in 3D viewer" button when onViewIn3D is not provided', () => {
    const image = createMockDroneImage();
    render(
      <ImageLightbox image={image} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />,
      { wrapper },
    );
    expect(screen.queryByRole('button', { name: /view in 3d viewer/i })).toBeNull();
  });

  it('should call onViewIn3D when "View in 3D viewer" button is clicked', async () => {
    const user = userEvent.setup();
    const onViewIn3D = vi.fn();
    const image = createMockDroneImage();
    render(
      <ImageLightbox image={image} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} onViewIn3D={onViewIn3D} />,
      { wrapper },
    );
    await user.click(screen.getByRole('button', { name: /view in 3d viewer/i }));
    expect(onViewIn3D).toHaveBeenCalledOnce();
  });
});
