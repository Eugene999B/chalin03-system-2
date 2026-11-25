import {useAuth} from "../context/AuthContext";
import {useLocation,Navigate,Link} from "react-router";
import Layout from "../components/Layout";
import LoginPage from "./LoginPage";
import StaffAccountSecurityPage from "./StaffAccountSecurityPage";
import OwnershipReconciliationPanel from "../components/OwnershipReconciliationPanel";
import SalesPlanningScenario from "../components/SalesPlanningScenario";
import OwnershipFinancialPreview from "../components/OwnershipFinancialPreview";
import "../styles/customerCreditProfile.css";

const sections=[
 {title:"Business operations",items:[
 {title:"Dashboard",description:"Business performance and ownership overview",path:"/",icon:"🏠",keywords:"home overview"},
 {title:"Sales History",description:"Receipt ownership and sales reconciliation",path:"/sales-history",icon:"🧾",keywords:"sale receipts"},
 {title:"Debts",description:"Ownership reconciliation and recorded outstanding balances",path:"/debts",icon:"📒",keywords:"debt receivables collections"},
 {title:"Reports",description:"Business ownership and recorded costs",path:"/reports",icon:"📊",keywords:"sales profit reporting"},
 {title:"Exports",description:"Scoped receipt reconciliation export",path:"/exports",icon:"📥",keywords:"download CSV"}]},
 {title:"Administration",items:[
 {title:"Settings",description:"Planning assumptions and ownership controls",path:"/users-settings",icon:"⚙️",keywords:"planning settings algorithm"},
 {title:"Account Security",description:"Authenticator and account protection",path:"/account-security",icon:"🔐",keywords:"authentication security"}]}
];
const paths=sections.flatMap(s=>s.items.map(i=>i.path));
const titles={"/":"Dashboard","/sales-history":"Sales history","/debts":"Debts","/reports":"Reports","/exports":"Exports","/users-settings":"Settings"};
export default function StaffBusinessPortal(){
 const {user,isLoggedIn,loading,logout,branchId,branchName,isSparePartsWorkspace,mustChangePassword}=useAuth();
 const location=useLocation();
 if(loading)return <main role="status" style={{minHeight:"100vh",display:"grid",placeItems:"center"}}>Restoring your secure Chalin 03 session…</main>;
 if(!isLoggedIn||!user)return <LoginPage/>;
 if(user.is_original_system_administrator!==true||mustChangePassword||!isSparePartsWorkspace||!branchId)return <main className="ccp" style={{maxWidth:680,margin:"48px auto"}}><h2>CHALIN03 · Staff portal</h2><p role="alert">This reporting workspace requires an authorized original administrator session in a selected Spare Parts store, with account security setup completed.</p><button onClick={()=>logout()}>Sign out</button></main>;
 if(!paths.includes(location.pathname))return <Navigate to="/" replace/>;
 const page=location.pathname;
 return <Layout reportingSections={sections}>
 {page==="/account-security"?<StaffAccountSecurityPage/>:<div className="staff-business-content" key={page+"-"+branchId}>
 <header className="staff-business-header"><div><small>CHALIN03 · {branchName||branchId}</small><h1>{titles[page]}</h1><p>Business ownership reporting · Selected store · Read-only ledger</p></div><span>Spare Parts</span></header>
 {page==="/"&&<><div className="staff-business-shortcuts">{sections[0].items.filter(i=>i.path!=="/").map(i=><Link key={i.path} to={i.path}><span>{i.icon}</span><strong>{i.title}</strong><small>{i.description}</small></Link>)}</div><SalesPlanningScenario key={"scenario-"+branchId} branchId={branchId}/><section className="ccp"><OwnershipFinancialPreview branchId={branchId}/></section></>}
 {page==="/sales-history"&&<section className="ccp"><h2>Recorded sales by verified ownership</h2><OwnershipFinancialPreview branchId={branchId}/><OwnershipReconciliationPanel branchId={branchId} showUnavailable/></section>}
 {["/debts","/reports","/exports"].includes(page)&&<section className="ccp"><h2>Receipt ownership reconciliation</h2><p>Company, partner and unresolved receipt totals. Until ownership is verified, company-only sales, debts and profit cannot be presented as confirmed amounts.</p><OwnershipFinancialPreview branchId={branchId}/></section>}
 {page==="/users-settings"&&<><SalesPlanningScenario branchId={branchId} editable/><OwnershipReconciliationPanel branchId={branchId} showUnavailable/></>}
 </div>}
 </Layout>;
}
