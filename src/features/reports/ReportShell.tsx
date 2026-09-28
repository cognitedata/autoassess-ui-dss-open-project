import { Suspense, createContext, useContext } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { Button, Loader } from '@cognite/aura/components';
import { IconArrowLeft } from '@tabler/icons-react';
import type { UseQueryResult } from '@tanstack/react-query';

import type { InspectionResult } from '../viewer/InspectionResultService';
import { useInspectionResults } from '../viewer/useInspectionResults';
import { AUTOASSESS_SPACE } from '../../shared/cdf/dataModel';

type UseInspectionResultsFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseQueryResult<InspectionResult[], Error>;

export type ReportShellContextType = {
  useInspectionResults: UseInspectionResultsFn;
};

const defaultDeps: ReportShellContextType = { useInspectionResults };

export const ReportShellContext = createContext<ReportShellContextType>(defaultDeps);

const navItemClass = (isActive: boolean) =>
  [
    'block rounded px-3 py-1.5 text-sm transition-colors',
    isActive
      ? 'bg-accent text-accent-foreground font-medium'
      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
  ].join(' ');

export function ReportShell() {
  const { vesselId = '', areaId = '' } = useParams<{ vesselId: string; areaId: string }>();
  const navigate = useNavigate();
  const { useInspectionResults: useResultsDep } = useContext(ReportShellContext);
  const { data: campaigns = [] } = useResultsDep(AUTOASSESS_SPACE, areaId);

  const basePath = `/vessels/${vesselId}/areas/${areaId}/report`;

  return (
    <div className="flex min-h-screen">
      <nav
        aria-label="Report navigation"
        className="flex w-56 shrink-0 flex-col border-r border-border bg-background"
      >
        <div className="border-b border-border p-4">
          <p className="text-sm font-semibold text-foreground">Inspection Reports</p>
        </div>

        <div className="p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => navigate(`/vessels/${vesselId}/areas/${areaId}`)}
          >
            <IconArrowLeft size={14} aria-hidden />
            3D Viewer
          </Button>
        </div>

        <div className="px-2 pb-1">
          <NavLink to={basePath} end className={({ isActive }) => navItemClass(isActive)}>
            Summary
          </NavLink>
        </div>

        {campaigns.length > 0 && (
          <>
            <div className="mx-2 my-1 border-t border-border" />
            <p className="px-4 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Campaigns
            </p>
            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {campaigns.map((c) => (
                <NavLink
                  key={c.externalId}
                  to={`${basePath}/${c.externalId}`}
                  className={({ isActive }) => navItemClass(isActive)}
                >
                  {c.date}
                </NavLink>
              ))}
            </div>
          </>
        )}
      </nav>

      <div className="flex-1 overflow-auto">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16">
              <Loader role="status" size={32} />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}
