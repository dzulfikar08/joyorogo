import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import App from "./App";
import { AdminErrorBoundary } from "./error-screen";
import { queryClient } from "./query-client";
import { ThemeProvider } from "./theme";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AdminErrorBoundary>
          <App />
        </AdminErrorBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
