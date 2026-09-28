import type { CogniteClient, NodeDefinition } from '@cognite/sdk';
import {
  STRUCTURAL_ELEMENT_VIEW,
  STRUCTURAL_ELEMENT_CONTAINER,
  getContainerProperty,
  getViewKey,
} from '../../shared/cdf/dataModel';

export type ElementType = 'manhole' | 'longitudinal' | 'wall' | 'compartment';

export interface StructuralElement {
  space: string;
  externalId: string;
  elementType: ElementType;
  label: number;
  center: [number, number, number];
  areaExternalId: string;
}

export interface StructuralElementService {
  listForArea(areaSpace: string, areaExternalId: string): Promise<StructuralElement[]>;
}

export class CdfStructuralElementService implements StructuralElementService {
  constructor(private readonly client: CogniteClient) {}

  async listForArea(areaSpace: string, areaExternalId: string): Promise<StructuralElement[]> {
    const response = await this.client.instances.list({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...STRUCTURAL_ELEMENT_VIEW } }],
      filter: {
        equals: {
          property: getContainerProperty(STRUCTURAL_ELEMENT_CONTAINER, 'area'),
          value: { space: areaSpace, externalId: areaExternalId },
        },
      },
      limit: 1000,
    });
    return response.items.filter(isNode).map(mapNodeToStructuralElement);
  }
}

function isNode(item: NodeDefinition | { instanceType: string }): item is NodeDefinition {
  return item.instanceType === 'node';
}

const VALID_ELEMENT_TYPES = new Set<string>(['manhole', 'longitudinal', 'wall', 'compartment']);

function mapNodeToStructuralElement(item: NodeDefinition): StructuralElement {
  const props =
    item.properties?.[STRUCTURAL_ELEMENT_VIEW.space]?.[getViewKey(STRUCTURAL_ELEMENT_VIEW)] ?? {};
  const areaRef = props['area'] as { space: string; externalId: string } | undefined;
  const rawType = String(props['elementType'] ?? '');
  const elementType: ElementType = VALID_ELEMENT_TYPES.has(rawType)
    ? (rawType as ElementType)
    : 'longitudinal';
  return {
    space: item.space,
    externalId: item.externalId,
    elementType,
    label: typeof props['label'] === 'number' ? props['label'] : 0,
    center: [
      typeof props['centerX'] === 'number' ? props['centerX'] : 0,
      typeof props['centerY'] === 'number' ? props['centerY'] : 0,
      typeof props['centerZ'] === 'number' ? props['centerZ'] : 0,
    ],
    areaExternalId: areaRef?.externalId ?? '',
  };
}
