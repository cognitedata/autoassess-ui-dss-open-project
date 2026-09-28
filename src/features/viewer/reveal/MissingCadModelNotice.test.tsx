import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MissingCadModelNotice } from './MissingCadModelNotice';

describe(MissingCadModelNotice.name, () => {
  it('says dss worker is building the model of meshes without one', () => {
    render(<MissingCadModelNotice waitingCampaignIds={['result-1']} processingCampaignIds={[]} />);

    expect(screen.getByText('3D model not ready yet')).toBeInTheDocument();
    expect(screen.getByText(/waiting for a/)).toHaveTextContent('result-1 — waiting for a dss worker');
    expect(screen.getByText(/waiting for a/)).toHaveTextContent('dss campaign build-3d-model --campaign result-1');
    expect(screen.getByText('dss campaign build-3d-model --campaign result-1')).toBeInTheDocument();
  });

  it('says the model is processing when CDF is still converting it', () => {
    render(<MissingCadModelNotice waitingCampaignIds={[]} processingCampaignIds={['result-1']} />);

    expect(screen.getByText(/being processed in CDF/)).toBeInTheDocument();
    expect(screen.queryByText(/build-3d-model/)).not.toBeInTheDocument();
  });

  it('lists every campaign that is missing a model, once', () => {
    render(
      <MissingCadModelNotice waitingCampaignIds={['result-1', 'result-2']} processingCampaignIds={['result-2']} />,
    );

    expect(screen.getByText('dss campaign build-3d-model --campaign result-1')).toBeInTheDocument();
    expect(screen.getByText(/result-2 .*being processed/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
