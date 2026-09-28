import type { CogniteClient, FileInfo, NodeDefinition, PropertyValueGroupV3 } from '@cognite/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CdfCampaignCadModelService, derivedId } from './CampaignCadModelService';

describe(CdfCampaignCadModelService.name, () => {
  let retrieve: ReturnType<typeof vi.fn<CogniteClient['instances']['retrieve']>>;
  let retrieveFiles: ReturnType<typeof vi.fn<CogniteClient['files']['retrieve']>>;
  let service: CdfCampaignCadModelService;
  let nodes: NodeDefinition[];

  beforeEach(() => {
    nodes = [];
    retrieve = vi.fn<CogniteClient['instances']['retrieve']>((request) => {
      const wanted = new Set(request.items.map((i) => i.externalId));
      return Promise.resolve({ items: nodes.filter((n) => wanted.has(n.externalId)) });
    });
    retrieveFiles = vi.fn<CogniteClient['files']['retrieve']>(() => Promise.resolve([]));
    service = new CdfCampaignCadModelService({ instances: { retrieve }, files: { retrieve: retrieveFiles } });
  });

  it('should resolve file ids to CogniteFile external ids, ignoring unknown ids', async () => {
    await service.listForCampaigns([{ externalId: 'result-1', cdfFileIds: [11, 12] }]);

    expect(retrieveFiles).toHaveBeenCalledWith([{ id: 11 }, { id: 12 }], { ignoreUnknownIds: true });
  });

  it("should return each mesh file's own model (per-file)", async () => {
    retrieveFiles.mockResolvedValue([fileInfo(11, 'f1'), fileInfo(12, 'f2')]);
    nodes = [modelNode('f1-cad-model', 11), revisionNode('f1-cad-revision', 600), modelNode('f2-cad-model', 12), revisionNode('f2-cad-revision', 601)];

    const { models, meshesWithoutModel } = await service.listForCampaigns([
      { externalId: 'result-1', cdfFileIds: [11, 12] },
    ]);

    expect(models).toEqual([
      {
        key: 'result-1/f1-cad-model',
        campaignExternalId: 'result-1',
        sourceFileId: 11,
        modelId: 500,
        revisionId: 600,
        status: 'Done',
        collisionProxyFileId: 700,
        hasTexture: true,
        palette: { seg_ff0000_c0: [255, 0, 0] },
      },
      expect.objectContaining({ key: 'result-1/f2-cad-model', revisionId: 601, sourceFileId: 12 }),
    ]);
    expect(meshesWithoutModel).toEqual([]);
  });

  it('should fall back to the legacy campaign model when the files have none', async () => {
    retrieveFiles.mockResolvedValue([fileInfo(11, 'f1', 100)]);
    nodes = [modelNode('result-1-cad-model', null, 200), revisionNode('result-1-cad-revision', 600)];

    const { models, meshesWithoutModel } = await service.listForCampaigns([
      { externalId: 'result-1', cdfFileIds: [11] },
    ]);

    expect(models).toEqual([
      expect.objectContaining({ key: 'result-1/result-1-cad-model', campaignExternalId: 'result-1', sourceFileId: null }),
    ]);
    expect(meshesWithoutModel).toEqual([]);
  });

  it('should treat classic files (no CogniteFile) as covered by the legacy model', async () => {
    nodes = [modelNode('result-1-cad-model', null, 200), revisionNode('result-1-cad-revision', 600)];

    const { models, meshesWithoutModel } = await service.listForCampaigns([
      { externalId: 'result-1', cdfFileIds: [11] },
    ]);

    expect(models.map((m) => m.key)).toEqual(['result-1/result-1-cad-model']);
    expect(meshesWithoutModel).toEqual([]);
  });

  it('should mix per-file and legacy models, and report meshes added after the legacy model', async () => {
    // f1 predates the legacy model (covered), f2 has its own model, f3 was added later (missing)
    retrieveFiles.mockResolvedValue([fileInfo(11, 'f1', 100), fileInfo(12, 'f2', 300), fileInfo(13, 'f3', 400)]);
    nodes = [
      modelNode('result-1-cad-model', null, 200),
      revisionNode('result-1-cad-revision', 600),
      modelNode('f2-cad-model', 12),
      revisionNode('f2-cad-revision', 601),
    ];

    const { models, meshesWithoutModel } = await service.listForCampaigns([
      { externalId: 'result-1', cdfFileIds: [11, 12, 13] },
    ]);

    expect(models.map((m) => m.key)).toEqual(['result-1/f2-cad-model', 'result-1/result-1-cad-model']);
    expect(meshesWithoutModel).toEqual([{ campaignExternalId: 'result-1', fileId: 13 }]);
  });

  it('should not show the legacy model when every file has its own model', async () => {
    retrieveFiles.mockResolvedValue([fileInfo(12, 'f2', 300)]);
    nodes = [
      modelNode('result-1-cad-model', null, 200),
      revisionNode('result-1-cad-revision', 600),
      modelNode('f2-cad-model', 12),
      revisionNode('f2-cad-revision', 601),
    ];

    const { models } = await service.listForCampaigns([{ externalId: 'result-1', cdfFileIds: [12] }]);

    expect(models.map((m) => m.key)).toEqual(['result-1/f2-cad-model']);
  });

  it('should follow a file that moved to another campaign', async () => {
    retrieveFiles.mockResolvedValue([fileInfo(12, 'f2', 300)]);
    nodes = [modelNode('f2-cad-model', 12), revisionNode('f2-cad-revision', 601)];

    const { models, meshesWithoutModel } = await service.listForCampaigns([
      { externalId: 'result-old', cdfFileIds: [] },
      { externalId: 'result-new', cdfFileIds: [12] },
    ]);

    expect(models.map((m) => [m.campaignExternalId, m.key])).toEqual([['result-new', 'result-new/f2-cad-model']]);
    expect(meshesWithoutModel).toEqual([]);
  });

  it('should report meshes that have no model at all', async () => {
    retrieveFiles.mockResolvedValue([fileInfo(11, 'f1')]);

    const { models, meshesWithoutModel } = await service.listForCampaigns([
      { externalId: 'result-1', cdfFileIds: [11] },
    ]);

    expect(models).toEqual([]);
    expect(meshesWithoutModel).toEqual([{ campaignExternalId: 'result-1', fileId: 11 }]);
  });

  it('should request per-file and legacy node ids from Core DM', async () => {
    retrieveFiles.mockResolvedValue([fileInfo(11, 'f1')]);

    await service.listForCampaigns([{ externalId: 'result-1', cdfFileIds: [11] }]);

    const requested = retrieve.mock.calls.flatMap((c) => c[0].items.map((i) => i.externalId));
    expect(requested.sort()).toEqual(
      ['f1-cad-model', 'f1-cad-revision', 'result-1-cad-model', 'result-1-cad-revision'].sort(),
    );
    expect(retrieve.mock.calls[0][0].sources?.[0].source).toMatchObject({ space: 'cdf_cdm' });
  });

  it('should skip models with an unparseable or unsafe model id', async () => {
    retrieveFiles.mockResolvedValue([fileInfo(11, 'f1')]);
    nodes = [
      modelNode('f1-cad-model', 11, 0, ['threeDModelId:9007199254740993', 'collisionProxyFileId:700']),
      revisionNode('f1-cad-revision', 600),
    ];

    const { models, meshesWithoutModel } = await service.listForCampaigns([
      { externalId: 'result-1', cdfFileIds: [11] },
    ]);

    expect(models).toEqual([]);
    expect(meshesWithoutModel).toHaveLength(1);
  });

  it('should tolerate a missing or invalid description', async () => {
    retrieveFiles.mockResolvedValue([fileInfo(11, 'f1')]);
    nodes = [modelNode('f1-cad-model', 11, 0, undefined, 'not json'), revisionNode('f1-cad-revision', 600)];

    const { models } = await service.listForCampaigns([{ externalId: 'result-1', cdfFileIds: [11] }]);

    expect(models[0].palette).toEqual({});
    expect(models[0].hasTexture).toBe(false);
  });

  it('should make no requests when no campaign has a mesh', async () => {
    expect(await service.listForCampaigns([{ externalId: 'result-1', cdfFileIds: [] }])).toEqual({
      models: [],
      meshesWithoutModel: [],
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(retrieveFiles).not.toHaveBeenCalled();
  });

  it('should propagate request errors', async () => {
    retrieveFiles.mockRejectedValue(new Error('403'));

    await expect(service.listForCampaigns([{ externalId: 'result-1', cdfFileIds: [11] }])).rejects.toThrow('403');
  });
});

describe(derivedId.name, () => {
  it('should append the suffix', () => {
    expect(derivedId('f1', '-cad-model')).toBe('f1-cad-model');
  });

  it('should cut the base so the id fits 255 characters, like the SDK', () => {
    const id = derivedId('x'.repeat(300), '-cad-revision');

    expect(id).toHaveLength(255);
    expect(id.endsWith('-cad-revision')).toBe(true);
  });
});

function fileInfo(id: number, externalId: string, createdMs = 1): FileInfo {
  return {
    id,
    name: `${externalId}.ply`,
    instanceId: { space: 'autoassess', externalId },
    uploaded: true,
    createdTime: new Date(createdMs),
    lastUpdatedTime: new Date(createdMs),
  };
}

function modelNode(
  externalId: string,
  sourceFileId: number | null,
  createdTime = 0,
  tags = ['autoassess', 'threeDModelId:500', 'collisionProxyFileId:700', ...(sourceFileId ? [`sourceFileId:${sourceFileId}`] : [])],
  description = JSON.stringify({ palette: { seg_ff0000_c0: [255, 0, 0] }, hasTexture: true }),
): NodeDefinition {
  return node(externalId, 'CogniteCADModel/v1', { name: 'mesh', tags, description }, createdTime);
}

function revisionNode(externalId: string, revisionId: number, status = 'Done'): NodeDefinition {
  return node(externalId, 'CogniteCADRevision/v1', { revisionId, status });
}

function node(externalId: string, viewKey: string, props: PropertyValueGroupV3, createdTime = 0): NodeDefinition {
  return {
    instanceType: 'node',
    space: 'autoassess',
    externalId,
    version: 1,
    createdTime,
    lastUpdatedTime: createdTime,
    properties: { cdf_cdm: { [viewKey]: props } },
  };
}
