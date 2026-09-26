import { ccc } from "@ckb-ccc/connector-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ccc.Provider
      name="CKBuilder week 6"
      defaultClient={new ccc.ClientPublicTestnet()}
    >
      <App />
    </ccc.Provider>
  </StrictMode>,
);
