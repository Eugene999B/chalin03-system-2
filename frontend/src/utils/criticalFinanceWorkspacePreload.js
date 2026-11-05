import EquipmentSalesWorkspacePage from "../pages/EquipmentSalesWorkspacePage.jsx";

const GLOBAL_PRELOAD_KEY = "__chalin03CriticalFinanceWorkspace";

export function installCriticalFinanceWorkspacePreload() {
  // App.jsx still uses React.lazy for secondary route splitting. Retaining the
  // exact workspace module from the entry bundle means the Applications route
  // never needs a separate network chunk before it can render.
  globalThis[GLOBAL_PRELOAD_KEY] = EquipmentSalesWorkspacePage;
}
