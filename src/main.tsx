import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Theme is owned by the ui store (explicit light/dark/system, default "light");
// index.html pins data-theme="light" so first paint is deterministic.

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
