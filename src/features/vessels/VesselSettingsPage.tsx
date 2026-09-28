import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  Loader,
} from '@cognite/aura/components';
import { IconArrowLeft } from '@tabler/icons-react';
import { useVesselSettingsViewModel } from './useVesselSettingsViewModel';
import { DeleteConfirmDialog } from '../../shared/components/DeleteConfirmDialog';

export function VesselSettingsPage() {
  const { vesselId = '' } = useParams<{ vesselId: string }>();
  const navigate = useNavigate();
  const { vessel, isLoading, error, updateVessel, isUpdating, deleteVessel, isDeleting } =
    useVesselSettingsViewModel(vesselId);

  const [name, setName] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (vessel && !initialized) {
    setInitialized(true);
    setName(vessel.name);
  }

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
          <AlertDescription>Failed to load vessel: {error.message}</AlertDescription>
        </Alert>
      </main>
    );
  }

  const nameUnchanged = name === (vessel?.name ?? '');

  return (
    <main className="p-8 max-w-lg">
      <div className="mb-8 flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <IconArrowLeft size={16} aria-hidden />
          Back
        </Button>
        <h1 className="text-2xl font-semibold">Vessel settings</h1>
      </div>

      <div className="mb-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="vessel-name">Name</Label>
          <Input
            id="vessel-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isUpdating}
          />
        </div>
        <Button
          onClick={() => updateVessel(name)}
          disabled={isUpdating || nameUnchanged || name.trim() === ''}
        >
          {isUpdating ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <section>
        <h2 className="text-base font-semibold text-destructive-foreground mb-3">Danger zone</h2>
        <Button
          variant="destructive"
          onClick={() => setDeleteDialogOpen(true)}
          disabled={isDeleting}
        >
          Delete vessel
        </Button>
      </section>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        entityName={vessel?.name ?? ''}
        entityKind="vessel"
        isDeleting={isDeleting}
        onConfirm={() => {
          deleteVessel();
          setDeleteDialogOpen(false);
          navigate('/');
        }}
      />
    </main>
  );
}
