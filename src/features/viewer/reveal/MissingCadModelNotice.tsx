import { cn } from '../../../lib/utils';

type Props = {
  /** Campaigns with a mesh that no 3D model shows yet (`dss worker` builds it). */
  waitingCampaignIds: string[];
  /** Campaigns with a 3D model CDF is still processing. */
  processingCampaignIds: string[];
  className?: string;
};

export function MissingCadModelNotice({ waitingCampaignIds, processingCampaignIds, className }: Props) {
  const processing = new Set(processingCampaignIds);
  const campaignIds = [...new Set([...waitingCampaignIds, ...processingCampaignIds])];
  return (
    <div
      className={cn('rounded-lg bg-black/60 px-4 py-3 text-left text-sm text-white backdrop-blur-sm', className)}
      data-testid="missing-cad-model-notice"
    >
      <p className="font-medium">3D model not built yet</p>
      <ul className="mt-1 space-y-1 text-white/80">
        {campaignIds.map((id) =>
          processing.has(id) && !waitingCampaignIds.includes(id) ? (
            <li key={id}>{id} — being processed in CDF, it appears here automatically when done.</li>
          ) : processing.has(id) ? (
            <li key={id}>{id} — being processed in CDF; more meshes are waiting for `dss worker`.</li>
          ) : (
            <li key={id}>
              {id}: 3D model being built by <code className="font-mono">dss worker</code>; it appears here
              automatically. No worker running? Run{' '}
              <code className="font-mono">{`dss campaign build-3d-model --campaign ${id}`}</code>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
