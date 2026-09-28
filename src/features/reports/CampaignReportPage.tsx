import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  AlertDescription,
  Loader,
} from '@cognite/aura/components';
import { cn } from '../../lib/utils';

import { AUTOASSESS_SPACE } from '../../shared/cdf/dataModel';
import { NdtBoxPlot } from './NdtBoxPlot';
import { CampaignImagesGrid } from './CampaignImagesGrid';
import { ImageLightbox } from './ImageLightbox';
import {
  CampaignReportViewModelContext,
  useCampaignReportViewModel,
} from './useCampaignReportViewModel';
import type { CampaignReportViewModelContextType } from './useCampaignReportViewModel';
import type { NdtMeasurement } from '../viewer/NdtMeasurementService';
import type { CampaignMetric } from '../viewer/CampaignMetricService';
import type { DroneImage } from '../viewer/DroneImageService';

export { CampaignReportViewModelContext };
export type { CampaignReportViewModelContextType };

type Tab = 'overview' | 'ndt' | 'images';

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  ndt: 'NDT',
  images: 'Images',
};

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  });
}

function formatMetric(metric: CampaignMetric): string {
  if (metric.unit === 'percentage') {
    return `${metric.value}%`;
  }
  return metric.value.toFixed(4);
}

function NdtMeasurementsTable({ measurements }: { measurements: NdtMeasurement[] }) {
  if (measurements.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">No NDT measurements for this campaign.</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Timestamp</th>
            <th className="pb-2 font-medium text-right">Thickness (mm)</th>
          </tr>
        </thead>
        <tbody>
          {measurements.map((m) => (
            <tr key={m.externalId} className="border-b border-border/50">
              <td className="py-2 pr-4 text-xs">{formatTimestamp(m.timestamp)}</td>
              <td className="py-2 text-right">{m.thicknessMm.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CampaignReportPage() {
  const { vesselId = '', areaId = '', campaignId = '' } = useParams<{
    vesselId: string;
    areaId: string;
    campaignId: string;
  }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);

  const {
    vesselName,
    areaName,
    campaignDate,
    measurementCount,
    medianThicknessMm,
    boxStats,
    measurements,
    metrics,
    images,
    imagesIsLoading,
    imagesError,
    isLoading,
    error,
  } = useCampaignReportViewModel(AUTOASSESS_SPACE, areaId, campaignId, vesselId);

  const selectedImage: DroneImage | null =
    selectedImageIndex !== null ? (images[selectedImageIndex] ?? null) : null;

  return (
    <main className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">
          {campaignDate ? `Campaign ${campaignDate}` : 'Campaign Report'}
        </h1>
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
          <AlertDescription>Failed to load campaign report: {error.message}</AlertDescription>
        </Alert>
      )}

      {!isLoading && !error && (
        <>
          {/* Tab bar */}
          <div role="tablist" aria-label="Report tabs" className="mb-6 flex border-b border-border">
            {(['overview', 'ndt', 'images'] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-2 text-sm font-medium transition-colors',
                  activeTab === tab
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          <div role="tabpanel" aria-label="Overview" hidden={activeTab !== 'overview'}>
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard label="NDT measurements" value={measurementCount} />
              <StatCard
                label="Median thickness"
                value={medianThicknessMm !== null ? `${medianThicknessMm.toFixed(1)} mm` : '—'}
              />
            </div>
            {metrics.length > 0 && (
              <>
                <h2 className="mt-6 mb-3 text-base font-semibold">Metrics</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {metrics.map((m) => (
                    <StatCard key={m.externalId} label={m.name} value={formatMetric(m)} />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* NDT tab */}
          <div role="tabpanel" aria-label="NDT" hidden={activeTab !== 'ndt'}>
            <div className="mb-6 rounded-lg border border-border bg-background p-4">
              <NdtBoxPlot campaigns={boxStats ? [boxStats] : []} />
            </div>
            <h2 className="mb-3 text-base font-semibold">Measurements</h2>
            <NdtMeasurementsTable measurements={measurements} />
          </div>

          {/* Images tab */}
          <div role="tabpanel" aria-label="Images" hidden={activeTab !== 'images'}>
            {imagesIsLoading && (
              <div className="flex justify-center py-16">
                <Loader role="status" size={32} />
              </div>
            )}
            {imagesError && (
              <Alert variant="error" role="alert">
                <AlertDescription>
                  Failed to load images: {imagesError.message}
                </AlertDescription>
              </Alert>
            )}
            {!imagesIsLoading && !imagesError && (
              <CampaignImagesGrid
                images={images}
                onSelect={(img) => setSelectedImageIndex(images.indexOf(img))}
              />
            )}
          </div>

          {/* Lightbox — rendered outside tab panels so position:fixed is not clipped */}
          {selectedImage !== null && (
            <ImageLightbox
              image={selectedImage}
              onClose={() => setSelectedImageIndex(null)}
              onPrev={
                selectedImageIndex !== null && selectedImageIndex > 0
                  ? () => setSelectedImageIndex(selectedImageIndex - 1)
                  : null
              }
              onNext={
                selectedImageIndex !== null && selectedImageIndex < images.length - 1
                  ? () => setSelectedImageIndex(selectedImageIndex + 1)
                  : null
              }
              onViewIn3D={() =>
                navigate(`/vessels/${vesselId}/areas/${areaId}?flyToImage=${selectedImage.externalId}`)
              }
            />
          )}
        </>
      )}
    </main>
  );
}
