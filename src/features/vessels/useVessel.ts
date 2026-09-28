import { useVessels } from './useVessels';
import type { Vessel } from './VesselService';

export function useVessel(externalId: string): {
  data: Vessel | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useVessels();
  return {
    data: data?.find((v) => v.externalId === externalId),
    isLoading,
    error: error ?? null,
  };
}
