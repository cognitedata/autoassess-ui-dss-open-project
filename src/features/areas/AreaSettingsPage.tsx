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
import { useAreaSettingsViewModel } from './useAreaSettingsViewModel';
import { DeleteConfirmDialog } from '../../shared/components/DeleteConfirmDialog';

export function AreaSettingsPage() {
  const { vesselId = '', areaId = '' } = useParams<{ vesselId: string; areaId: string }>();
  const navigate = useNavigate();
  const { area, isLoading, error, updateArea, isUpdating, deleteArea, isDeleting } =
    useAreaSettingsViewModel(vesselId, areaId);

  const [name, setName] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (area && !initialized) {
    setInitialized(true);
    setName(area.name);
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
          <AlertDescription>Failed to load area: {error.message}</AlertDescription>
        </Alert>
      </main>
    );
  }

  const nameUnchanged = name === (area?.name ?? '');

  return (
    <main className="p-8 max-w-lg">
      <div className="mb-8 flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/vessels/${vesselId}/areas`)}>
          <IconArrowLeft size={16} aria-hidden />
          Back
        </Button>
        <h1 className="text-2xl font-semibold">Area settings</h1>
      </div>

      <div className="mb-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="area-name">Name</Label>
          <Input
            id="area-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isUpdating}
          />
        </div>
        <Button
          onClick={() => updateArea(name)}
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
          Delete area
        </Button>
      </section>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        entityName={area?.name ?? ''}
        entityKind="area"
        isDeleting={isDeleting}
        onConfirm={() => {
          deleteArea();
          setDeleteDialogOpen(false);
          navigate(`/vessels/${vesselId}/areas`);
        }}
      />
    </main>
  );
}
