import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { SseProvider } from "./lib/sse-context";
import { App } from "./App";
import { ToastContainer } from "./components/toast-container";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SseProvider>
      <App />
      <ToastContainer />
    </SseProvider>
  </StrictMode>,
);
