import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@cognite/aura/components';
import { useState } from 'react';

import type { NewInspectionPlan, UpdateInspectionPlanInput } from './InspectionPlanService';
import type { MapOption } from './useInspectionPlansViewModel';

type PlanFormDialogProps =
  | {
      mode: 'create';
      open: boolean;
      onOpenChange: (open: boolean) => void;
      availableMaps: MapOption[];
      defaultMapExternalId: string | null;
      onSubmit: (input: NewInspectionPlan) => void;
      isSubmitting: boolean;
      error?: Error | null;
    }
  | {
      mode: 'edit';
      open: boolean;
      onOpenChange: (open: boolean) => void;
      initialValues: { name: string | null; description: string | null };
      /** Present only when the plan is Draft — lets the user change its reference map. */
      mapField?: { availableMaps: MapOption[]; currentMapExternalId: string | null };
      onSubmit: (input: UpdateInspectionPlanInput) => void;
      isSubmitting: boolean;
      error?: Error | null;
    };

export function PlanFormDialog(props: PlanFormDialogProps) {
  const { open, onOpenChange, isSubmitting, error } = props;
  const isCreate = props.mode === 'create';

  const [name, setName] = useState(props.mode === 'edit' ? props.initialValues.name ?? '' : '');
  const [description, setDescription] = useState(
    props.mode === 'edit' ? props.initialValues.description ?? '' : '',
  );
  // Present for create (always) and for edit only when the plan is Draft.
  const mapField = props.mode === 'create' ? { availableMaps: props.availableMaps } : props.mapField;
  // True when editing a plan that genuinely has no map yet (not merely "no
  // scans available") — the select must show this honestly as an explicit
  // "No map selected" choice rather than silently defaulting to some other
  // option, so the dialog reflects the plan's real current state.
  const isUnsetInEditMode =
    props.mode === 'edit' && props.mapField !== undefined && props.mapField.currentMapExternalId === null;

  const [mapExternalId, setMapExternalId] = useState(
    props.mode === 'create' ? props.defaultMapExternalId ?? '' : props.mapField?.currentMapExternalId ?? '',
  );

  // Re-seed the form on every subsequent open, since this component can stay
  // mounted (only `open` toggling) across multiple creates/edits.
  const [wasOpen, setWasOpen] = useState(open);
  if (open && !wasOpen) {
    setWasOpen(true);
    if (props.mode === 'edit') {
      setName(props.initialValues.name ?? '');
      setDescription(props.initialValues.description ?? '');
      setMapExternalId(props.mapField?.currentMapExternalId ?? '');
    } else {
      setName('');
      setDescription('');
      setMapExternalId(props.defaultMapExternalId ?? '');
    }
  } else if (open !== wasOpen) {
    setWasOpen(open);
  }

  function handleSubmit() {
    const trimmedName = name.trim() || undefined;
    const trimmedDescription = description.trim() || undefined;
    if (props.mode === 'create') {
      props.onSubmit({ mapExternalId, name: trimmedName, description: trimmedDescription });
    } else if (props.mapField && mapExternalId !== '') {
      // An empty selection here means "leave the map as-is (unset)" — never
      // write an empty-string relation.
      props.onSubmit({ mapExternalId, name: trimmedName, description: trimmedDescription });
    } else {
      props.onSubmit({ name: trimmedName, description: trimmedDescription });
    }
  }

  const title = isCreate ? 'Create plan' : 'Edit plan';
  const submitLabel = isCreate ? 'Create plan' : 'Save changes';
  const pendingLabel = isCreate ? 'Creating…' : 'Saving…';
  const errorMessage = error
    ? `Failed to ${isCreate ? 'create' : 'update'} plan: ${error.message}`
    : undefined;
  // Only creation requires an explicit map — editing may leave an already-unset
  // map unset while still saving other field changes.
  const canSubmit = !isSubmitting && (!isCreate || mapExternalId !== '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="plan-name">Name (optional)</Label>
            <Input
              id="plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 hull survey"
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="plan-description">Description (optional)</Label>
            <Textarea
              id="plan-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add notes about scope or purpose…"
              disabled={isSubmitting}
            />
          </div>

          {mapField && (
            <div className="space-y-2">
              <Label htmlFor="plan-map">Map</Label>
              <select
                id="plan-map"
                value={mapExternalId}
                onChange={(e) => setMapExternalId(e.target.value)}
                disabled={isSubmitting || mapField.availableMaps.length === 0}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
              >
                {mapField.availableMaps.length === 0 && (
                  <option value="">No completed scans</option>
                )}
                {isUnsetInEditMode && mapField.availableMaps.length > 0 && (
                  <option value="">No map selected</option>
                )}
                {mapField.availableMaps.map((map) => (
                  <option key={map.externalId} value={map.externalId}>
                    {map.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
        </div>

        <DialogFooter>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {isSubmitting ? pendingLabel : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
