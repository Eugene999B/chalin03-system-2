import {useEffect,useState} from "react";
import {useAuth} from "../context/AuthContext";
import {useLocation,Navigate,Link} from "react-router";
import Layout from "../components/Layout";
import LoginPage from "./LoginPage";
import StaffAccountSecurityPage from "./StaffAccountSecurityPage";
import StaffSalesResearch from "../components/StaffSalesResearch";
import "../styles/customerCreditProfile.css";
const sections=[
 {title:"Business research",items:[
 {title:"Dashboard",description:"Modeled sales overview",path:"/",icon:"🏠",keywords:"home overview"},
 {title:"Sales History",description:"Actual and modeled receipt quantities and values",path:"/sales-history",icon:"🧾",keywords:"sale receipts"},
 {title:"Debts",description:"Modeled receivables and collections",path:"/debts",icon:"📒",keywords:"debt receivables collections"},
 {title:"Reports",description:"Sales reduction scenario",path:"/reports",icon:"📊",keywords:"sales profit reporting"},
 {title:"Exports",description:"Download labeled research calculations",path:"/exports",icon:"📥",keywords:"download CSV"}]},
 {title:"Administration",items:[
 {title:"Settings",description:"Change research reduction percentage",path:"/users-settings",icon:"⚙️",keywords:"planning settings algorithm"},
 {title:"Account Security",description:"Authenticator and account protection",path:"/account-security",icon:"🔐",keywords:"authentication security"}]}
];
const paths=sections.flatMap(s=>s.items.map(i=>i.path));
const titles={"/":"Dashboard","/sales-history":"Sales history","/debts":"Debts","/reports":"Reports","/exports":"Exports","/users-settings":"Settings"};
function savedPercent(key){try{const v=localStorage.getItem(key);return v!==null&&/^(0|[1-9][0-9]?|100)$/.test(v)?Number(v):40;}catch{return 40;}}
function ResearchContent({user,branchId,branchName,page}){
 const key="chalin03:staff-sales-reduction:v1:"+user.id;
 const [percent,setPercent]=useState(()=>savedPercent(key));
 useEffect(()=>{try{localStorage.setItem(key,String(percent));}catch{}},[key,percent]);
 return <div className="staff-business-content">
 <header className="staff-business-header"><div><small>CHALIN03 · {branchName||branchId}</small><h1>{titles[page]}</h1><p>Research scenario · {percent}% sales volume reduction · Actual ledger unchanged</p></div><span>Spare Parts</span></header>
 {page==="/"&&<div className="staff-business-shortcuts">{sections[0].items.filter(i=>i.path!=="/").map(i=><Link key={i.path} to={i.path}><span>{i.icon}</span><strong>{i.title}</strong><small>{i.description}</small></Link>)}</div>}
 <StaffSalesResearch key={branchId+"-"+percent} branchId={branchId} percent={percent} setPercent={setPercent} page={page}/>
 </div>;
}
export default function StaffBusinessPortal(){
 const {user,isLoggedIn,loading,logout,branchId,branchName,isSparePartsWorkspace,mustChangePassword}=useAuth();
 const location=useLocation();
 if(loading)return <main role="status" style={{minHeight:"100vh",display:"grid",placeItems:"center"}}>Restoring your secure Chalin 03 session…</main>;
 if(!isLoggedIn||!user)return <LoginPage/>;
 if(user.is_original_system_administrator!==true||mustChangePassword||!isSparePartsWorkspace||!branchId)return <main className="ccp" style={{maxWidth:680,margin:"48px auto"}}><h2>CHALIN03 · Staff portal</h2><p role="alert">This reporting workspace requires an authorized original administrator session in a selected Spare Parts store, with account security setup completed.</p><button onClick={()=>logout()}>Sign out</button></main>;
 if(!paths.includes(location.pathname))return <Navigate to="/" replace/>;
 return <Layout reportingSections={sections}>{location.pathname==="/account-security"?<StaffAccountSecurityPage/>:<ResearchContent key={user.id} user={user} branchId={branchId} branchName={branchName} page={location.pathname}/>}</Layout>;
}
