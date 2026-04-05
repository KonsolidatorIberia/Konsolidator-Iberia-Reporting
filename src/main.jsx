import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css"; // OR "./index.css" depending on where main.jsx lives
import App from "./app/App.jsx";
import "./i18n.js";
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);