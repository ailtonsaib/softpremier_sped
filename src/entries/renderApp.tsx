import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/index.css";

export function renderApp(app: React.ReactNode) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>{app}</React.StrictMode>,
  );
}

export function returnToPortal() {
  const portalUrl = import.meta.env.VITE_PORTAL_URL;
  if (portalUrl) window.location.assign(portalUrl);
  else window.history.back();
}
