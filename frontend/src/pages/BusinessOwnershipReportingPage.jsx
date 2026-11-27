import {useAuth} from "../context/AuthContext";
import OwnershipReconciliationPanel from "../components/OwnershipReconciliationPanel";
import SalesPlanningScenario from "../components/SalesPlanningScenario";
import {Link} from "react-router";
export default function BusinessOwnershipReportingPage(){
 const {branchId,branchName,user}=useAuth();
 const authorized=user?.is_original_system_administrator===true||(String(user?.role).toLowerCase()==="admin"&&Number(user?.id)===1&&String(user?.username).toLowerCase()==="admin");
 if(!authorized)return <section className="ccp" role="alert"><h2>Access restricted</h2><p>Business ownership controls require the original system administrator.</p><Link to="/">Return to dashboard</Link></section>;
 return <main style={{maxWidth:1500,margin:"0 auto"}}>
  <section className="ccp"><div className="ccp-heading"><div><small>CHALIN03 · FINANCIAL RECONCILIATION</small><h2>Business ownership reporting</h2></div><span className="ccp-preview">Preview</span></div>
  <p>Selected store: <strong>{branchName||branchId}</strong>. Review verified company and partner ownership separately. The original financial ledger remains authoritative.</p>
  <p>Use receipt evidence to classify merchandise. Mixed or unresolved transactions remain visible until supporting financial allocations are reconciled. This workspace does not post or change sales, debts, payments or costs.</p>
  <Link to="/users-settings">System settings</Link></section>
  <SalesPlanningScenario key={"scenario-"+String(branchId)} branchId={branchId}/>
  <OwnershipReconciliationPanel key={String(branchId)} branchId={branchId} showUnavailable/>
 </main>;
}
