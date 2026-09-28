import type { CogniteClient } from '@cognite/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DRONE_IMAGE_VIEW, AUTOASSESS_SPACE } from '../../shared/cdf/dataModel';
import { createMockDroneImage } from '../../__mocks__/droneImages';

import {
  useDroneImagesForCampaign,
  UseDroneImagesForCampaignContext,
} from './useDroneImagesForCampaign';

type ContextType = { useCogniteSdk: () => CogniteClient };

function makeMockDroneImageNode(image = createMockDroneImage()) {
  return {
    instanceType: 'node' as const,
    space: image.space,
    externalId: image.externalId,
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [AUTOASSESS_SPACE]: {
        [`${DRONE_IMAGE_VIEW.externalId}/${DRONE_IMAGE_VIEW.version}`]: {
          campaignExternalId: image.campaignExternalId,
          frameId: image.frameId,
          timestamp: image.timestamp,
          positionX: image.position[0],
          positionY: image.position[1],
          positionZ: image.position[2],
          orientQx: image.orientationQuat[0],
          orientQy: image.orientationQuat[1],
          orientQz: image.orientationQuat[2],
          orientQw: image.orientationQuat[3],
          cdfFileId: image.cdfFileId,
          bboxMinX: image.bboxMin[0],
          bboxMinY: image.bboxMin[1],
          bboxMinZ: image.bboxMin[2],
          bboxMaxX: image.bboxMax[0],
          bboxMaxY: image.bboxMax[1],
          bboxMaxZ: image.bboxMax[2],
        },
      },
    },
  };
}

describe(useDroneImagesForCampaign.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let mockContext: ContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    const mockSdk = {
      instances: { list: mockInstancesList },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          UseDroneImagesForCampaignContext.Provider,
          { value: mockContext },
          children,
        ),
      );
  });

  it('should return loading state initially', () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const { result } = renderHook(
      () => useDroneImagesForCampaign('autoassess', 'result-01581'),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('should return images on success', async () => {
    const image = createMockDroneImage({ cdfFileId: 42 });
    mockInstancesList.mockResolvedValue({ items: [makeMockDroneImageNode(image)] });

    const { result } = renderHook(
      () => useDroneImagesForCampaign('autoassess', 'result-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].cdfFileId).toBe(42);
  });

  it('should return empty array when campaign has no images', async () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const { result } = renderHook(
      () => useDroneImagesForCampaign('autoassess', 'result-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('should return error state on failure', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => useDroneImagesForCampaign('autoassess', 'result-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should not fetch when campaignExternalId is empty', () => {
    const { result } = renderHook(
      () => useDroneImagesForCampaign('autoassess', ''),
      { wrapper },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockInstancesList).not.toHaveBeenCalled();
  });
});
