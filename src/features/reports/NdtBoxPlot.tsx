import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  useXAxisScale,
  useYAxisScale,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { CampaignBoxStats } from './ndtStats';

interface NdtBoxPlotProps {
  campaigns: CampaignBoxStats[];
  height?: number;
}

// ---- Internal chart data type ----

export interface ChartRow {
  label: string;
  campaignId: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  n: number;
}

export function toChartData(campaigns: CampaignBoxStats[]): ChartRow[] {
  return campaigns.map((c) => ({
    label: c.label,
    campaignId: c.campaignId,
    min: c.min,
    q1: c.q1,
    median: c.median,
    q3: c.q3,
    max: c.max,
    n: c.n,
  }));
}

// ---- Box plot overlay — uses Recharts v3 hooks (must be a direct chart child) ----

function BoxPlotOverlay({ data }: { data: ChartRow[] }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();

  if (!xScale || !yScale || data.length === 0) return null;

  // Derive band width from the start/end positions of the first label
  const firstLabel = data[0].label;
  const xStart = xScale(firstLabel, { position: 'start' });
  const xEnd = xScale(firstLabel, { position: 'end' });
  const bw = xStart !== undefined && xEnd !== undefined ? xEnd - xStart : 40;

  const barW = Math.min(bw * 0.6, 60);
  const hw = barW / 2;
  const capW = hw * 0.5;

  return (
    <g>
      {data.map((row) => {
        const cx = xScale(row.label, { position: 'middle' });
        const yMin = yScale(row.min);
        const yQ1 = yScale(row.q1);
        const yMed = yScale(row.median);
        const yQ3 = yScale(row.q3);
        const yMax = yScale(row.max);

        if (
          cx === undefined ||
          yMin === undefined ||
          yQ1 === undefined ||
          yMed === undefined ||
          yQ3 === undefined ||
          yMax === undefined
        ) {
          return null;
        }

        return (
          <g key={row.campaignId}>
            {/* IQR box: q1 → q3 */}
            <rect
              x={cx - hw} y={yQ3}
              width={barW} height={yQ1 - yQ3}
              fill="#3b82f6" fillOpacity={0.7}
              stroke="#2563eb" strokeWidth={1}
            />
            {/* Median line */}
            <line x1={cx - hw} y1={yMed} x2={cx + hw} y2={yMed} stroke="#1e40af" strokeWidth={2} />
            {/* Lower whisker: q1 → min */}
            <line x1={cx} y1={yQ1} x2={cx} y2={yMin} stroke="#64748b" strokeWidth={1.5} />
            {/* Upper whisker: q3 → max */}
            <line x1={cx} y1={yQ3} x2={cx} y2={yMax} stroke="#64748b" strokeWidth={1.5} />
            {/* Min cap */}
            <line x1={cx - capW} y1={yMin} x2={cx + capW} y2={yMin} stroke="#64748b" strokeWidth={1.5} />
            {/* Max cap */}
            <line x1={cx - capW} y1={yMax} x2={cx + capW} y2={yMax} stroke="#64748b" strokeWidth={1.5} />
          </g>
        );
      })}
    </g>
  );
}

// ---- Custom tooltip ----

export function BoxTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as ChartRow;
  const fmt = (v: number) => v.toFixed(1);

  return (
    <div className="rounded border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{row.label}</p>
      <p className="text-muted-foreground">n = {row.n} measurements</p>
      <div className="mt-1 space-y-0.5">
        <p>Max: <span className="font-medium">{fmt(row.max)} mm</span></p>
        <p>Q3: <span className="font-medium">{fmt(row.q3)} mm</span></p>
        <p>Median: <span className="font-medium">{fmt(row.median)} mm</span></p>
        <p>Q1: <span className="font-medium">{fmt(row.q1)} mm</span></p>
        <p>Min: <span className="font-medium">{fmt(row.min)} mm</span></p>
      </div>
    </div>
  );
}

export function NdtBoxPlot({ campaigns, height = 300 }: NdtBoxPlotProps) {
  if (campaigns.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No thickness data available
      </p>
    );
  }

  const data = toChartData(campaigns);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis
          unit=" mm"
          tick={{ fontSize: 12 }}
          tickFormatter={(v: number) => v.toFixed(1)}
          width={60}
          domain={[0, 'auto']}
        />
        <Tooltip content={BoxTooltip} />
        {/* Invisible bar over the full max height so the tooltip hover area works */}
        <Bar dataKey="max" fill="transparent" stroke="none" isAnimationActive={false} />
        {/* Box plot drawn via v3 hooks — must be a direct child of the chart */}
        <BoxPlotOverlay data={data} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
