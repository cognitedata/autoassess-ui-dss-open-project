import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Alert, AlertDescription, Loader } from '@cognite/aura/components';
import { CogniteSdkProvider } from '@cognite/app-sdk/react';
import { VesselListView } from './features/vessels/VesselListView';
import { VesselSettingsPage } from './features/vessels/VesselSettingsPage';
import { AreaListView } from './features/areas/AreaListView';
import { AreaSettingsPage } from './features/areas/AreaSettingsPage';
import { ReportShell } from './features/reports/ReportShell';

// Lazy-load the viewer: @cognite/reveal is large and not needed until navigation
const ViewerPage = lazy(() =>
  import('./features/viewer/ViewerPage').then((m) => ({ default: m.ViewerPage })),
);

const AreaReportPage = lazy(() =>
  import('./features/reports/AreaReportPage').then((m) => ({ default: m.AreaReportPage })),
);

const CampaignReportPage = lazy(() =>
  import('./features/reports/CampaignReportPage').then((m) => ({ default: m.CampaignReportPage })),
);

function App() {
  return (
    <CogniteSdkProvider
      loadingFallback={
        <main className="flex min-h-screen items-center justify-center bg-muted/50">
          <Loader role="status" size={32} />
        </main>
      }
      errorFallback={
        <main className="flex min-h-screen items-center justify-center bg-muted/50 p-8">
          <Alert variant="error" role="alert">
            <AlertDescription>Failed to connect to Fusion</AlertDescription>
          </Alert>
        </main>
      }
    >
      <div className="min-h-screen bg-muted/50 text-foreground">
        <Routes>
          <Route path="/" element={<VesselListView />} />
          <Route path="/vessels/:vesselId/settings" element={<VesselSettingsPage />} />
          <Route path="/vessels/:vesselId/areas" element={<AreaListView />} />
          <Route path="/vessels/:vesselId/areas/:areaId/settings" element={<AreaSettingsPage />} />
          <Route
            path="/vessels/:vesselId/areas/:areaId"
            element={
              <Suspense
                fallback={
                  <main className="flex min-h-screen items-center justify-center">
                    <Loader role="status" size={32} />
                  </main>
                }
              >
                <ViewerPage />
              </Suspense>
            }
          />
          <Route path="/vessels/:vesselId/areas/:areaId/report" element={<ReportShell />}>
            <Route
              index
              element={
                <Suspense
                  fallback={
                    <main className="flex min-h-screen items-center justify-center">
                      <Loader role="status" size={32} />
                    </main>
                  }
                >
                  <AreaReportPage />
                </Suspense>
              }
            />
            <Route
              path=":campaignId"
              element={
                <Suspense
                  fallback={
                    <main className="flex min-h-screen items-center justify-center">
                      <Loader role="status" size={32} />
                    </main>
                  }
                >
                  <CampaignReportPage />
                </Suspense>
              }
            />
          </Route>
        </Routes>
      </div>
    </CogniteSdkProvider>
  );
}

export default App;
