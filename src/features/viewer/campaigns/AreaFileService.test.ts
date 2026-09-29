import type { CogniteClient, FileInfo, NodeDefinition } from '@cognite/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CdfAreaFileService } from './AreaFileService';

describe(CdfAreaFileService.name, () => {
  let list: ReturnType<typeof vi.fn<CogniteClient['instances']['list']>>;
  let retrieveFiles: ReturnType<typeof vi.fn<CogniteClient['files']['retrieve']>>;
  let service: CdfAreaFileService;

  beforeEach(() => {
    list = vi.fn<CogniteClient['instances']['list']>(() => Promise.resolve({ items: [] }));
    retrieveFiles = vi.fn<CogniteClient['files']['retrieve']>(() => Promise.resolve([]));
    service = new CdfAreaFileService({ instances: { list }, files: { retrieve: retrieveFiles } });
  });

  it("should list the area's CogniteFiles by their area tag", async () => {
    await service.listForArea('area-1');

    const [request] = list.mock.calls[0];
    expect(request).toMatchObject({
      instanceType: 'node',
      sources: [{ source: { type: 'view', space: 'cdf_cdm', externalId: 'CogniteFile', version: 'v1' } }],
      filter: {
        and: [
          { equals: { property: ['node', 'space'], value: 'autoassess' } },
          { containsAny: { property: ['cdf_cdm', 'CogniteFile/v1', 'tags'], values: ['area:area-1'] } },
        ],
      },
    });
  });

  it('should return meshes and point clouds with their numeric file ids, newest first', async () => {
    list.mockResolvedValue({
      items: [
        fileNode('f1', ['autoassess', 'ply_mesh', 'area:area-1'], 100),
        fileNode('p1', ['autoassess', 'pcd_pointcloud', 'area:area-1', 'label:Labeled cloud'], 200),
        fileNode('proxy', ['autoassess', 'collision_proxy', 'area:area-1'], 300),
      ],
    });
    retrieveFiles.mockResolvedValue([fileInfo(11, 'f1'), fileInfo(12, 'p1')]);

    const files = await service.listForArea('area-1');

    expect(files).toEqual([
      { fileId: 12, externalId: 'p1', name: 'p1.pcd', kind: 'pointcloud', label: 'Labeled cloud', createdTime: 200, uploaded: true },
      { fileId: 11, externalId: 'f1', name: 'f1.pcd', kind: 'mesh', label: null, createdTime: 100, uploaded: true },
    ]);
    expect(retrieveFiles).toHaveBeenCalledWith(
      [{ instanceId: { space: 'autoassess', externalId: 'f1' } }, { instanceId: { space: 'autoassess', externalId: 'p1' } }],
      { ignoreUnknownIds: true },
    );
  });

  it('should follow the cursor to list every file', async () => {
    list
      .mockResolvedValueOnce({ items: [fileNode('f1', ['ply_mesh'], 1)], nextCursor: 'next' })
      .mockResolvedValueOnce({ items: [fileNode('f2', ['ply_mesh'], 2)] });
    retrieveFiles.mockResolvedValue([fileInfo(11, 'f1'), fileInfo(12, 'f2')]);

    const files = await service.listForArea('area-1');

    expect(files.map((f) => f.externalId)).toEqual(['f2', 'f1']);
    expect(list.mock.calls[1][0].cursor).toBe('next');
  });

  it('should skip files CDF has no numeric id for', async () => {
    list.mockResolvedValue({ items: [fileNode('f1', ['ply_mesh'], 1)] });

    expect(await service.listForArea('area-1')).toEqual([]);
  });

  it('should propagate request errors', async () => {
    list.mockRejectedValue(new Error('403'));

    await expect(service.listForArea('area-1')).rejects.toThrow('403');
  });
});

function fileNode(externalId: string, tags: string[], createdTime: number): NodeDefinition {
  return {
    instanceType: 'node',
    space: 'autoassess',
    externalId,
    version: 1,
    createdTime,
    lastUpdatedTime: createdTime,
    properties: { cdf_cdm: { 'CogniteFile/v1': { name: `${externalId}.pcd`, tags, isUploaded: true } } },
  };
}

function fileInfo(id: number, externalId: string): FileInfo {
  return {
    id,
    name: externalId,
    instanceId: { space: 'autoassess', externalId },
    uploaded: true,
    createdTime: new Date(0),
    lastUpdatedTime: new Date(0),
  };
}
