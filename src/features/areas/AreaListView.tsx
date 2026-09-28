import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Loader,
} from '@cognite/aura/components';
import { IconArrowLeft, IconPlus, IconSettings } from '@tabler/icons-react';
import { useAreaListViewModel } from './useAreaListViewModel';
import { AddAreaDialog } from './AddAreaDialog';
import { AUTOASSESS_SPACE } from '../../shared/cdf/dataModel';
import type { Area } from './AreaService';

interface AreaCardProps {
  area: Area;
  vesselId: string;
}

function AreaCard({ area, vesselId }: AreaCardProps) {
  const navigate = useNavigate();
  return (
    // NOTE: No Aura clickable-card component in @cognite/aura@0.1.5. Custom build with Aura tokens.
    <div className="relative group">
      <button
        aria-label={area.name}
        className="w-full text-left"
        onClick={() => navigate(`/vessels/${vesselId}/areas/${area.externalId}`)}
      >
        <Card className="h-full transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle>{area.name}</CardTitle>
            <CardDescription>{area.areaType}</CardDescription>
          </CardHeader>
        </Card>
      </button>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button
          aria-label={`Settings for ${area.name}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm hover:bg-accent"
          onClick={(e) => { e.stopPropagation(); navigate(`/vessels/${vesselId}/areas/${area.externalId}/settings`); }}
        >
          <IconSettings size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function AreaListView() {
  const { vesselId = '' } = useParams<{ vesselId: string }>();
  const navigate = useNavigate();
  const { areas, vesselName, isLoading, error } = useAreaListViewModel(vesselId);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <IconArrowLeft size={16} aria-hidden />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">Select an area</h1>
            {vesselName && (
              <p className="mt-0.5 text-sm text-muted-foreground">{vesselName}</p>
            )}
          </div>
        </div>
        <Button size="sm" onClick={() => setAddDialogOpen(true)}>
          <IconPlus size={16} aria-hidden />
          Add area
        </Button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader role="status" size={32} />
        </div>
      )}

      {error && (
        <Alert variant="error" role="alert">
          <AlertDescription>Failed to load areas: {error.message}</AlertDescription>
        </Alert>
      )}

      {!isLoading && !error && areas.length === 0 && (
        // NOTE: No Aura EmptyState component in @cognite/aura@0.1.5. Custom build with Aura tokens.
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-base font-medium text-foreground">No areas available for this vessel</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Areas will appear here once they are added to the vessel.
          </p>
        </div>
      )}

      {!isLoading && !error && areas.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((area) => (
            <AreaCard
              key={`${area.space}:${area.externalId}`}
              area={area}
              vesselId={vesselId}
            />
          ))}
        </div>
      )}

      <AddAreaDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        vesselSpace={AUTOASSESS_SPACE}
        vesselExternalId={vesselId}
      />
    </main>
  );
}
