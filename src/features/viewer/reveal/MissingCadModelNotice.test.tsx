import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MissingCadModelNotice } from './MissingCadModelNotice';

describe(MissingCadModelNotice.name, () => {
  it('shows the build command for campaigns without a 3D model', () => {
    render(<MissingCadModelNotice campaignIds={['result-1']} processingCampaignIds={new Set()} />);

    expect(screen.getByText('3D model not built yet')).toBeInTheDocument();
    expect(screen.getByText('dss campaign build-3d-model --campaign result-1')).toBeInTheDocument();
  });

  it('says the model is processing when CDF is still converting it', () => {
    render(<MissingCadModelNotice campaignIds={['result-1']} processingCampaignIds={new Set(['result-1'])} />);

    expect(screen.getByText(/being processed in CDF/)).toBeInTheDocument();
    expect(screen.queryByText(/build-3d-model/)).not.toBeInTheDocument();
  });

  it('lists every campaign that is missing a model', () => {
    render(
      <MissingCadModelNotice campaignIds={['result-1', 'result-2']} processingCampaignIds={new Set(['result-2'])} />,
    );

    expect(screen.getByText('dss campaign build-3d-model --campaign result-1')).toBeInTheDocument();
    expect(screen.getByText(/result-2 .*being processed/)).toBeInTheDocument();
  });
});
