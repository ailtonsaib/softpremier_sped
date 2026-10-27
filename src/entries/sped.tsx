import { SpedApp } from "../app/components/SpedApp";
import { LicenseGate } from "../app/components/LicenseGate";
import { renderApp, returnToPortal } from "./renderApp";

renderApp(
  <LicenseGate product="sped">
    <SpedApp onBack={returnToPortal} />
  </LicenseGate>,
);
