import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Dashboard from "../app/Dashboard";
import "../app/globals.css";
import "../app/theme-fixes.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing dashboard root element");
}

createRoot(root).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
);
