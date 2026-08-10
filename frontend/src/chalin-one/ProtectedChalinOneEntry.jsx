import { FeatureFlagProvider } from "../context/FeatureFlagContext";
import ChalinOneStandaloneEntry from "./ChalinOneStandaloneEntry";
import "../index.css";
import "../styles/userPermissionManager.mobile.css";
import "../styles/commandGateExtensions.css";
import "../styles/mobileExperience.css";
import "../styles/adminMobileHotfix.css";

export default function ProtectedChalinOneEntry() {
  return (
    <FeatureFlagProvider>
      <ChalinOneStandaloneEntry />
    </FeatureFlagProvider>
  );
}
