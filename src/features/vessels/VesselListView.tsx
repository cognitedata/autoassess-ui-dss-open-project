import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../../../assets/autoassess-logo.png';
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
import { IconPlus, IconSettings } from '@tabler/icons-react';
import { useVesselListViewModel } from './useVesselListViewModel';
import { AddVesselDialog } from './AddVesselDialog';
import type { Vessel } from './VesselService';

function VesselCard({ vessel }: { vessel: Vessel }) {
  const navigate = useNavigate();
  return (
    // NOTE: No Aura clickable-card component in @cognite/aura@0.1.5. Custom build with Aura tokens.
    <div className="relative group">
      <button
        aria-label={vessel.name}
        className="w-full text-left"
        onClick={() => navigate(`/vessels/${vessel.externalId}/areas`)}
      >
        <Card className="h-full transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle>{vessel.name}</CardTitle>
            <CardDescription>{vessel.vesselType}</CardDescription>
          </CardHeader>
        </Card>
      </button>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button
          aria-label={`Settings for ${vessel.name}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm hover:bg-accent"
          onClick={(e) => { e.stopPropagation(); navigate(`/vessels/${vessel.externalId}/settings`); }}
        >
          <IconSettings size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function VesselListView() {
  const { vessels, isLoading, error } = useVesselListViewModel();
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader role="status" size={32} />
      </main>
    );
  }

  if (error) {
    return (
      <main className="p-8">
        <Alert variant="error" role="alert">
          <AlertDescription>Failed to load vessels: {error.message}</AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="p-8">
      <div className="mb-8 flex items-center gap-4">
        <img src={logo} alt="AutoAssess" className="h-12 w-auto" />
        <h1 className="text-3xl font-bold">UI-DSS</h1>
      </div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Select a vessel</h2>
        <Button size="sm" onClick={() => setAddDialogOpen(true)}>
          <IconPlus size={16} aria-hidden />
          Add vessel
        </Button>
      </div>

      {vessels.length === 0 ? (
        // NOTE: No Aura EmptyState component in @cognite/aura@0.1.5. Custom build with Aura tokens.
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-base font-medium text-foreground">No vessels available</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add vessels to your project to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vessels.map((vessel) => (
            <VesselCard
              key={`${vessel.space}:${vessel.externalId}`}
              vessel={vessel}
            />
          ))}
        </div>
      )}

      <AddVesselDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </main>
  );
}
