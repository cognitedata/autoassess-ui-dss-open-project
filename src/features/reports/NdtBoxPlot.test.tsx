import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TooltipContentProps } from 'recharts';
import { NdtBoxPlot, toChartData, BoxTooltip } from './NdtBoxPlot';
import type { ChartRow } from './NdtBoxPlot';
import type { CampaignBoxStats } from './ndtStats';

function makeTooltipProps(
  overrides: Partial<TooltipContentProps> = {},
): TooltipContentProps {
  return {
    active: false,
    payload: [],
    label: undefined,
    coordinate: undefined,
    accessibilityLayer: false,
    activeIndex: undefined,
    ...overrides,
  } as TooltipContentProps;
}

function makePayloadItem(row: ChartRow): TooltipContentProps['payload'][number] {
  return { payload: row, graphicalItemId: 'ndt-box-plot' } as TooltipContentProps['payload'][number];
}

function makeStat(overrides: Partial<CampaignBoxStats> = {}): CampaignBoxStats {
  return {
    campaignId: 'campaign-1',
    label: '2024-09-15',
    min: 8,
    q1: 10,
    median: 12,
    q3: 14,
    max: 16,
    n: 5,
    ...overrides,
  };
}

describe(NdtBoxPlot.name, () => {
  it('should render the empty state when campaigns array is empty', () => {
    render(<NdtBoxPlot campaigns={[]} />);
    expect(screen.getByText('No thickness data available')).toBeInTheDocument();
  });

  it('should render recharts container with a single campaign', () => {
    const { container } = render(<NdtBoxPlot campaigns={[makeStat()]} />);
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  it('should render recharts container with multiple campaigns', () => {
    const { container } = render(
      <NdtBoxPlot
        campaigns={[
          makeStat({ campaignId: 'c1', label: '2024-09-15' }),
          makeStat({ campaignId: 'c2', label: '2024-03-01' }),
        ]}
      />,
    );
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });
});

describe(toChartData.name, () => {
  it('maps campaign box stats to chart rows', () => {
    const stat = makeStat();
    expect(toChartData([stat])).toEqual([
      {
        label: stat.label,
        campaignId: stat.campaignId,
        min: stat.min,
        q1: stat.q1,
        median: stat.median,
        q3: stat.q3,
        max: stat.max,
        n: stat.n,
      },
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(toChartData([])).toEqual([]);
  });
});

describe(BoxTooltip.name, () => {
  it('renders nothing when inactive', () => {
    const { container } = render(<BoxTooltip {...makeTooltipProps({ active: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when active but payload is empty', () => {
    const { container } = render(<BoxTooltip {...makeTooltipProps({ active: true })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the row stats when active with a payload', () => {
    const row = toChartData([makeStat()])[0];
    render(
      <BoxTooltip {...makeTooltipProps({ active: true, payload: [makePayloadItem(row)] })} />,
    );

    expect(screen.getByText(row.label)).toBeInTheDocument();
    expect(screen.getByText('n = 5 measurements')).toBeInTheDocument();
    expect(screen.getByText('16.0 mm')).toBeInTheDocument(); // max
    expect(screen.getByText('8.0 mm')).toBeInTheDocument(); // min
  });
});
