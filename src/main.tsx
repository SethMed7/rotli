import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Theme is an explicit three-way setting (light / dark / system) owned by a
// later phase's store. The scaffold pins "light" so demos are deterministic.
document.documentElement.dataset.theme = "light";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
