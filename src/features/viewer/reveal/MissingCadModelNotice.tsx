import { cn } from '../../../lib/utils';

type Props = {
  /** Campaigns that have an uploaded mesh but no finished CDF 3D model. */
  campaignIds: string[];
  /** Subset whose 3D model exists but is still being processed by CDF. */
  processingCampaignIds: Set<string>;
  className?: string;
};

export function MissingCadModelNotice({ campaignIds, processingCampaignIds, className }: Props) {
  return (
    <div
      className={cn('rounded-lg bg-black/60 px-4 py-3 text-left text-sm text-white backdrop-blur-sm', className)}
      data-testid="missing-cad-model-notice"
    >
      <p className="font-medium">3D model not built yet</p>
      <ul className="mt-1 space-y-1 text-white/80">
        {campaignIds.map((id) =>
          processingCampaignIds.has(id) ? (
            <li key={id}>{id} — being processed in CDF, it appears here automatically when done.</li>
          ) : (
            <li key={id}>
              Run <code className="font-mono">{`dss campaign build-3d-model --campaign ${id}`}</code>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
