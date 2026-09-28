import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';

import { createMockDroneImage } from '../../__mocks__/droneImages';
import { UseDroneImagesContext } from '../viewer/useDroneImages';
import type { UseDroneImagesDeps } from '../viewer/useDroneImages';
import { CampaignImagesGrid } from './CampaignImagesGrid';

describe(CampaignImagesGrid.name, () => {
  let mockUseCogniteSdk: ReturnType<typeof vi.fn>;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    const mockSdk = {
      files: {
        getDownloadUrls: vi.fn().mockResolvedValue([
          { downloadUrl: 'https://image.test/frame.jpg' },
        ]),
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

  it('should show empty state when there are no images', () => {
    render(<CampaignImagesGrid images={[]} onSelect={vi.fn()} />, { wrapper });
    expect(screen.getByText('No images for this campaign.')).toBeInTheDocument();
  });

  it('should render a button for each image', () => {
    const images = [
      createMockDroneImage(),
      createMockDroneImage(),
      createMockDroneImage(),
    ];
    render(<CampaignImagesGrid images={images} onSelect={vi.fn()} />, { wrapper });
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('should call onSelect with the clicked image', async () => {
    const user = userEvent.setup();
    const image = createMockDroneImage();
    const onSelect = vi.fn();

    render(<CampaignImagesGrid images={[image]} onSelect={onSelect} />, { wrapper });

    await user.click(screen.getByRole('button', { name: `Frame ${image.frameId}` }));

    expect(onSelect).toHaveBeenCalledWith(image);
  });

  it('should not render a button when images is empty', () => {
    render(<CampaignImagesGrid images={[]} onSelect={vi.fn()} />, { wrapper });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
