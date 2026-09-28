import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  AlertDescription,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Loader,
} from '@cognite/aura/components';

import { AUTOASSESS_SPACE } from '../../shared/cdf/dataModel';
import { NdtBoxPlot } from './NdtBoxPlot';
import {
  AreaReportViewModelContext,
  useAreaReportViewModel,
} from './useAreaReportViewModel';
import type {
  AreaReportViewModelContextType,
  CampaignSummary,
  DefectSummaryRow,
} from './useAreaReportViewModel';

export { AreaReportViewModelContext };
export type { AreaReportViewModelContextType };

interface CampaignCardProps {
  campaign: CampaignSummary;
  vesselId: string;
  areaId: string;
}

function CampaignCard({ campaign, vesselId, areaId }: CampaignCardProps) {
  const navigate = useNavigate();
  return (
    <button
      aria-label={`View report for campaign ${campaign.date}`}
      className="w-full text-left"
      onClick={() =>
        navigate(`/vessels/${vesselId}/areas/${areaId}/report/${campaign.campaignId}`)
      }
    >
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle>{campaign.date}</CardTitle>
          <CardDescription>Campaign</CardDescription>
        </CardHeader>
      </Card>
    </button>
  );
}

function DefectSummaryTable({ rows }: { rows: DefectSummaryRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        No defect detections found for this area.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Defect class</th>
            <th className="pb-2 pr-4 font-medium text-right">Total</th>
            <th className="pb-2 pr-4 font-medium text-right">Confirmed</th>
            <th className="pb-2 pr-4 font-medium text-right">Under review</th>
            <th className="pb-2 font-medium text-right">Dismissed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.defectClass} className="border-b border-border/50">
              <td className="py-2 pr-4 capitalize">{row.defectClass}</td>
              <td className="py-2 pr-4 text-right">{row.total}</td>
              <td className="py-2 pr-4 text-right">{row.confirmed}</td>
              <td className="py-2 pr-4 text-right">{row.underReview}</td>
              <td className="py-2 text-right">{row.dismissed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AreaReportPage() {
  const { vesselId = '', areaId = '' } = useParams<{
    vesselId: string;
    areaId: string;
  }>();

  const { vesselName, areaName, campaigns, boxStats, defectSummary, isLoading, error } =
    useAreaReportViewModel(AUTOASSESS_SPACE, areaId, vesselId);

  return (
    <main className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Summary</h1>
        {(vesselName || areaName) && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[vesselName, areaName].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader role="status" size={32} />
        </div>
      )}

      {error && (
        <Alert variant="error" role="alert">
          <AlertDescription>Failed to load report: {error.message}</AlertDescription>
        </Alert>
      )}

      {!isLoading && !error && (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold">NDT Thickness Trend</h2>
            <div className="rounded-lg border border-border bg-background p-4">
              <NdtBoxPlot campaigns={boxStats} />
            </div>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold">Defect Detections</h2>
            <DefectSummaryTable rows={defectSummary} />
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Campaigns</h2>
            {campaigns.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No inspection campaigns found for this area.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {campaigns.map((c) => (
                  <CampaignCard
                    key={c.campaignId}
                    campaign={c}
                    vesselId={vesselId}
                    areaId={areaId}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
