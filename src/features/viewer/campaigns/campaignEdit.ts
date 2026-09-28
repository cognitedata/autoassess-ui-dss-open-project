import type { InspectionResult } from '../InspectionResultService';

/** What the edit dialog lets you change on a campaign. */
export interface CampaignDraft {
  campaignDate: string;
  /** PLY mesh files (`cdfFileIds`). */
  meshFileIds: number[];
  /** PCD point clouds with their display labels (`pcdFileIds` / `pcdFileLabels`). */
  pointClouds: { fileId: number; label: string }[];
}

/** One campaign node to upsert. `create` is set for a new campaign. */
export interface CampaignWrite {
  space: string;
  externalId: string;
  campaignDate?: string;
  cdfFileIds: number[];
  pcdFileIds: number[];
  pcdFileLabels: string[];
  create?: { areaSpace: string; areaExternalId: string };
}

export interface CampaignTarget {
  space: string;
  externalId: string;
  create?: { areaSpace: string; areaExternalId: string };
}

/**
 * The campaign writes that apply *draft* to *target*. A file belongs to one campaign only, so
 * every other campaign listing a file the draft selects loses it in the same batch. Files and
 * 3D models themselves are never touched — only the campaign nodes' file lists and date.
 */
export function planCampaignSave(
  campaigns: InspectionResult[],
  target: CampaignTarget,
  draft: CampaignDraft,
): CampaignWrite[] {
  const meshIds = [...new Set(draft.meshFileIds)];
  const pointClouds = draft.pointClouds.filter(
    (pc, i) => draft.pointClouds.findIndex((other) => other.fileId === pc.fileId) === i,
  );
  const selected = new Set([...meshIds, ...pointClouds.map((pc) => pc.fileId)]);

  const writes: CampaignWrite[] = [
    {
      space: target.space,
      externalId: target.externalId,
      campaignDate: draft.campaignDate,
      cdfFileIds: meshIds,
      pcdFileIds: pointClouds.map((pc) => pc.fileId),
      pcdFileLabels: pointClouds.map((pc) => pc.label),
      ...(target.create && { create: target.create }),
    },
  ];
  for (const campaign of campaigns) {
    if (campaign.externalId === target.externalId) continue;
    const keepPcd = campaign.pcdFileIds.map((id) => !selected.has(id));
    const cdfFileIds = campaign.cdfFileIds.filter((id) => !selected.has(id));
    const pcdFileIds = campaign.pcdFileIds.filter((_, i) => keepPcd[i]);
    if (cdfFileIds.length === campaign.cdfFileIds.length && pcdFileIds.length === campaign.pcdFileIds.length) {
      continue;
    }
    writes.push({
      space: campaign.space,
      externalId: campaign.externalId,
      cdfFileIds,
      pcdFileIds,
      pcdFileLabels: campaign.pcdFileLabels.filter((_, i) => keepPcd[i] ?? true).slice(0, pcdFileIds.length),
    });
  }
  return writes;
}

/** `YYYY-MM-DD` and a real calendar date. */
export function isValidCampaignDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
