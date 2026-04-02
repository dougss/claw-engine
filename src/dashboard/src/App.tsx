import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SseProvider } from "./lib/sse-context";
import { Layout } from "./components/layout";
import { PipelinePage } from "./pages/pipeline";
import { DagPage } from "./pages/dag";
import { SessionsPage } from "./pages/sessions";
import { MetricsPage } from "./pages/metrics";
import { LogsPage } from "./pages/logs";

export function App() {
  return (
    <SseProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/pipeline" replace />} />
            <Route path="pipeline" element={<PipelinePage />} />
            <Route path="dag" element={<DagPage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="metrics" element={<MetricsPage />} />
            <Route path="logs" element={<LogsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SseProvider>
  );
}
