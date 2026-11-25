import {useAuth} from "../context/AuthContext";
import {useLocation,Navigate} from "react-router";
import LoginPage from "./LoginPage";
import StaffAccountSecurityPage from "./StaffAccountSecurityPage";
import OwnershipReconciliationPanel from "../components/OwnershipReconciliationPanel";
import SalesPlanningScenario from "../components/SalesPlanningScenario";
import "../styles/customerCreditProfile.css";

export default function StaffBusinessPortal(){
 const {user,isLoggedIn,loading,logout,branchId,branchName,isSparePartsWorkspace,mustChangePassword}=useAuth();
 const location=useLocation();
 if(loading)return <main role="status" style={{minHeight:"100vh",display:"grid",placeItems:"center"}}>Restoring your secure Chalin 03 session…</main>;
 if(!isLoggedIn||!user)return <LoginPage/>;
 if(user.is_original_system_administrator!==true||mustChangePassword||!isSparePartsWorkspace||!branchId)return <main className="ccp" style={{maxWidth:680,margin:"48px auto"}}><h2>CHALIN03 · Staff portal</h2><p role="alert">This reporting workspace requires an authorized original administrator session in a selected Spare Parts store, with account security setup completed.</p><button onClick={()=>logout()}>Sign out</button></main>;
 if(location.pathname==="/account-security")return <StaffAccountSecurityPage/>;
 if(location.pathname!=="/")return <Navigate to="/" replace/>;
 return <main style={{minHeight:"100vh",maxWidth:1440,margin:"0 auto",padding:"24px 16px"}}>
 <section className="ccp"><div className="ccp-heading"><div><small>CHALIN03 · STAFF WORKSPACE</small><h2>Business reporting</h2></div><button onClick={()=>logout()}>Sign out</button></div>
 <p>Selected store: <strong>{branchName||branchId}</strong>. Reports separate verified business ownership and clearly distinguish estimates from actual recorded transactions.</p>
 <p>Original sales, debts, inventory and payments remain authoritative. Unclassified records are not treated as verified company or partner sales.</p>
 <a href="/account-security">Account security</a></section>
 <SalesPlanningScenario key={"scenario-"+branchId} branchId={branchId} editable/>
 <OwnershipReconciliationPanel key={String(branchId)} branchId={branchId} showUnavailable/>
 </main>;
}
