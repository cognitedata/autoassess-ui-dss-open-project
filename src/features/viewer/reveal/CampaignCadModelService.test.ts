import type { CogniteClient, NodeDefinition, PropertyValueGroupV3 } from '@cognite/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CdfCampaignCadModelService } from './CampaignCadModelService';

describe(CdfCampaignCadModelService.name, () => {
  let retrieve: ReturnType<typeof vi.fn<CogniteClient['instances']['retrieve']>>;
  let service: CdfCampaignCadModelService;

  beforeEach(() => {
    retrieve = vi.fn<CogniteClient['instances']['retrieve']>();
    service = new CdfCampaignCadModelService({ instances: { retrieve } });
  });

  it('should request the deterministic Core DM model and revision nodes per campaign', async () => {
    retrieve.mockResolvedValue({ items: [] });

    await service.listForCampaigns(['result-1', 'result-2']);

    const [modelCall, revisionCall] = retrieve.mock.calls.map((c) => c[0]);
    expect(modelCall.items).toEqual([
      { instanceType: 'node', space: 'autoassess', externalId: 'result-1-cad-model' },
      { instanceType: 'node', space: 'autoassess', externalId: 'result-2-cad-model' },
    ]);
    expect(modelCall.sources?.[0].source).toMatchObject({ space: 'cdf_cdm', externalId: 'CogniteCADModel' });
    expect(revisionCall.items[0].externalId).toBe('result-1-cad-revision');
    expect(revisionCall.sources?.[0].source).toMatchObject({ externalId: 'CogniteCADRevision' });
  });

  it('should parse ids from tags and palette from the description', async () => {
    retrieve
      .mockResolvedValueOnce({ items: [modelNode('result-1')] })
      .mockResolvedValueOnce({ items: [revisionNode('result-1', 600, 'Done')] });

    const models = await service.listForCampaigns(['result-1']);

    expect(models).toEqual([
      {
        campaignExternalId: 'result-1',
        modelId: 500,
        revisionId: 600,
        status: 'Done',
        collisionProxyFileId: 700,
        hasTexture: true,
        palette: { seg_ff0000_c0: [255, 0, 0] },
      },
    ]);
  });

  it('should skip campaigns whose model or revision node is missing', async () => {
    retrieve
      .mockResolvedValueOnce({ items: [modelNode('result-1')] })
      .mockResolvedValueOnce({ items: [] });

    expect(await service.listForCampaigns(['result-1'])).toEqual([]);
  });

  it('should skip models with an unparseable or unsafe model id', async () => {
    retrieve
      .mockResolvedValueOnce({ items: [modelNode('result-1', ['threeDModelId:9007199254740993'])] })
      .mockResolvedValueOnce({ items: [revisionNode('result-1', 600, 'Done')] });

    expect(await service.listForCampaigns(['result-1'])).toEqual([]);
  });

  it('should tolerate a missing or invalid description', async () => {
    const node = modelNode('result-1', undefined, 'not json');
    retrieve
      .mockResolvedValueOnce({ items: [node] })
      .mockResolvedValueOnce({ items: [revisionNode('result-1', 600, 'Done')] });

    const [model] = await service.listForCampaigns(['result-1']);

    expect(model.palette).toEqual({});
    expect(model.hasTexture).toBe(false);
  });

  it('should make no requests for an empty campaign list', async () => {
    expect(await service.listForCampaigns([])).toEqual([]);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('should propagate request errors', async () => {
    retrieve.mockRejectedValue(new Error('403'));

    await expect(service.listForCampaigns(['result-1'])).rejects.toThrow('403');
  });
});

function modelNode(
  campaign: string,
  tags = ['autoassess', 'threeDModelId:500', 'collisionProxyFileId:700'],
  description = JSON.stringify({ palette: { seg_ff0000_c0: [255, 0, 0] }, hasTexture: true }),
): NodeDefinition {
  return node(`${campaign}-cad-model`, 'CogniteCADModel/v1', { name: `${campaign} mesh`, tags, description });
}

function revisionNode(campaign: string, revisionId: number, status: string): NodeDefinition {
  return node(`${campaign}-cad-revision`, 'CogniteCADRevision/v1', { revisionId, status });
}

function node(externalId: string, viewKey: string, props: PropertyValueGroupV3): NodeDefinition {
  return {
    instanceType: 'node',
    space: 'autoassess',
    externalId,
    version: 1,
    createdTime: 0,
    lastUpdatedTime: 0,
    properties: { cdf_cdm: { [viewKey]: props } },
  };
}
