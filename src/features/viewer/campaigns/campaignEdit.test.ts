import { describe, expect, it } from 'vitest';

import { createMockInspectionResult } from '../../../__mocks__/inspectionResults';

import { isValidCampaignDate, planCampaignSave } from './campaignEdit';

describe(planCampaignSave.name, () => {
  it('should write the target campaign with the draft date and files', () => {
    const campaigns = [campaign('result-a', { cdfFileIds: [1], date: '2026-09-01' })];

    const writes = planCampaignSave(campaigns, target('result-a'), draft({ campaignDate: '2026-09-02', meshFileIds: [1, 2] }));

    expect(writes).toEqual([
      {
        space: 'autoassess',
        externalId: 'result-a',
        campaignDate: '2026-09-02',
        cdfFileIds: [1, 2],
        pcdFileIds: [],
        pcdFileLabels: [],
      },
    ]);
  });

  it('should remove a moved mesh from the campaign that had it, in the same batch', () => {
    const campaigns = [campaign('result-a', { cdfFileIds: [1, 2] }), campaign('result-b', { cdfFileIds: [] })];

    const writes = planCampaignSave(campaigns, target('result-b'), draft({ meshFileIds: [2] }));

    expect(writes.map((w) => [w.externalId, w.cdfFileIds])).toEqual([
      ['result-b', [2]],
      ['result-a', [1]],
    ]);
    expect(writes[1].campaignDate).toBeUndefined();
  });

  it('should keep point-cloud labels aligned when a point cloud moves away', () => {
    const campaigns = [
      campaign('result-a', { pcdFileIds: [5, 6, 7], pcdFileLabels: ['five', 'six', 'seven'] }),
      campaign('result-b'),
    ];

    const writes = planCampaignSave(campaigns, target('result-b'), draft({ pointClouds: [{ fileId: 6, label: 'six' }] }));

    const source = writes.find((w) => w.externalId === 'result-a');
    expect(source?.pcdFileIds).toEqual([5, 7]);
    expect(source?.pcdFileLabels).toEqual(['five', 'seven']);
    expect(writes[0].pcdFileLabels).toEqual(['six']);
  });

  it('should not write campaigns the edit does not touch', () => {
    const campaigns = [campaign('result-a', { cdfFileIds: [1] }), campaign('result-b', { cdfFileIds: [3] })];

    const writes = planCampaignSave(campaigns, target('result-a'), draft({ meshFileIds: [1] }));

    expect(writes.map((w) => w.externalId)).toEqual(['result-a']);
  });

  it('should create a new campaign on the area', () => {
    const campaigns = [campaign('result-a', { cdfFileIds: [1] })];

    const writes = planCampaignSave(
      campaigns,
      { space: 'autoassess', externalId: 'result-new', create: { areaSpace: 'autoassess', areaExternalId: 'area-1' } },
      draft({ campaignDate: '2026-09-28', meshFileIds: [1] }),
    );

    expect(writes[0]).toMatchObject({
      externalId: 'result-new',
      campaignDate: '2026-09-28',
      cdfFileIds: [1],
      create: { areaSpace: 'autoassess', areaExternalId: 'area-1' },
    });
    expect(writes[1]).toMatchObject({ externalId: 'result-a', cdfFileIds: [] });
  });

  it('should drop duplicate file ids', () => {
    const writes = planCampaignSave(
      [campaign('result-a')],
      target('result-a'),
      draft({ meshFileIds: [1, 1], pointClouds: [{ fileId: 5, label: 'x' }, { fileId: 5, label: 'y' }] }),
    );

    expect(writes[0].cdfFileIds).toEqual([1]);
    expect(writes[0].pcdFileIds).toEqual([5]);
    expect(writes[0].pcdFileLabels).toEqual(['x']);
  });
});

describe(isValidCampaignDate.name, () => {
  it.each([
    ['2026-09-28', true],
    ['2026-02-30', false],
    ['2026-9-28', false],
    ['', false],
    ['not a date', false],
  ])('%s -> %s', (value, expected) => {
    expect(isValidCampaignDate(value)).toBe(expected);
  });
});

function campaign(externalId: string, overrides: Parameters<typeof createMockInspectionResult>[0] = {}) {
  return createMockInspectionResult({ externalId, ...overrides });
}

function target(externalId: string) {
  return { space: 'autoassess', externalId };
}

function draft(overrides: Partial<Parameters<typeof planCampaignSave>[2]> = {}): Parameters<typeof planCampaignSave>[2] {
  return { campaignDate: '2026-09-01', meshFileIds: [], pointClouds: [], ...overrides };
}
