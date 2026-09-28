import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CogniteClient } from '@cognite/sdk';
import { CdfStructuralElementService } from './StructuralElementService';
import type { StructuralElementService } from './StructuralElementService';
import {
  STRUCTURAL_ELEMENT_VIEW,
  STRUCTURAL_ELEMENT_CONTAINER,
  getContainerProperty,
} from '../../shared/cdf/dataModel';
import { createMockStructuralElement } from '../../__mocks__/structuralElements';

function makeMockElementNodeResponse(overrides: Record<string, unknown> = {}) {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'element-2-11',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [STRUCTURAL_ELEMENT_VIEW.space]: {
        [`${STRUCTURAL_ELEMENT_VIEW.externalId}/${STRUCTURAL_ELEMENT_VIEW.version}`]: {
          elementType: 'longitudinal',
          label: 2011,
          centerX: 4.17074,
          centerY: 0.237193,
          centerZ: 0.844808,
          area: { space: 'autoassess', externalId: 'area-01581' },
          ...overrides,
        },
      },
    },
  };
}

describe(CdfStructuralElementService.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let service: StructuralElementService;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    const mockClient = {
      instances: { list: mockInstancesList } as unknown as CogniteClient['instances'],
    };
    service = new CdfStructuralElementService(mockClient as CogniteClient);
  });

  it('should request element nodes filtered by area', async () => {
    // Arrange
    mockInstancesList.mockResolvedValue({ items: [] });

    // Act
    await service.listForArea('autoassess', 'area-01581');

    // Assert
    expect(mockInstancesList).toHaveBeenCalledWith({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...STRUCTURAL_ELEMENT_VIEW } }],
      filter: {
        equals: {
          property: getContainerProperty(STRUCTURAL_ELEMENT_CONTAINER, 'area'),
          value: { space: 'autoassess', externalId: 'area-01581' },
        },
      },
      limit: 1000,
    });
  });

  it('should map response node items to StructuralElement[]', async () => {
    // Arrange
    mockInstancesList.mockResolvedValue({ items: [makeMockElementNodeResponse()] });

    // Act
    const elements = await service.listForArea('autoassess', 'area-01581');

    // Assert
    expect(elements).toEqual([createMockStructuralElement()]);
  });

  it('should default unknown elementType to "longitudinal"', async () => {
    // Arrange
    mockInstancesList.mockResolvedValue({
      items: [makeMockElementNodeResponse({ elementType: 'unknown-class' })],
    });

    // Act
    const elements = await service.listForArea('autoassess', 'area-01581');

    // Assert
    expect(elements[0].elementType).toBe('longitudinal');
  });

  it('should propagate errors thrown by the SDK', async () => {
    // Arrange
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    // Act & Assert
    await expect(service.listForArea('autoassess', 'area-01581')).rejects.toThrow('Network error');
  });
});
