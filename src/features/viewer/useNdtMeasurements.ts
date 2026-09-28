import { useCogniteSdk } from '@cognite/app-sdk/react';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { CdfNdtMeasurementService } from './NdtMeasurementService';
import type { NdtMeasurement } from './NdtMeasurementService';

// ---- Dependency injection for useCogniteSdk ----

type UseNdtMeasurementsDeps = {
  useCogniteSdk: () => ReturnType<typeof useCogniteSdk>;
};

const defaultDeps: UseNdtMeasurementsDeps = { useCogniteSdk };

export const UseNdtMeasurementsContext =
  createContext<UseNdtMeasurementsDeps>(defaultDeps);

// ---- Query hook ----

export function useNdtMeasurements(
  areaSpace: string,
  areaExternalId: string,
): UseQueryResult<NdtMeasurement[], Error> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseNdtMeasurementsContext);
  const sdk = useCogniteSdkDep();

  return useQuery({
    queryKey: ['ndtMeasurements', areaSpace, areaExternalId],
    queryFn: () =>
      new CdfNdtMeasurementService(sdk).listForArea(areaSpace, areaExternalId),
    enabled: Boolean(areaSpace && areaExternalId),
    staleTime: 5 * 60 * 1000,
  });
}
