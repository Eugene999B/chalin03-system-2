import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext";
import "./DebtorIdentityStaffAnnouncement.css";

const POLICY="debtor-identity-policy-20261117-v1";
function acknowledged(key){
  try{return localStorage.getItem(key)==="acknowledged";}catch{return false;}
}
export default function DebtorIdentityStaffAnnouncement(){
  const {user,isLoggedIn,workspaceCode}=useAuth();
  const staffId=user?.id||user?.username;
  const key=POLICY+"-"+String(staffId||"unknown");
  const [closed,setClosed]=useState(()=>acknowledged(key));
  useEffect(()=>{setClosed(acknowledged(key));},[key]);
  if(!isLoggedIn||!staffId||closed)return null;
  const isSpareParts=!workspaceCode||workspaceCode==="spare_parts";
  function confirmRead(){
    try{localStorage.setItem(key,"acknowledged");}catch{}
    setClosed(true);
  }
  return (
    <aside className="debt-policy-announcement" role="alert" aria-label="CHALIN03 staff policy announcement">
      <div className="debt-policy-announcement__head">
        <span>CHALIN03 · IMPORTANT STAFF NOTICE</span>
        <button type="button" onClick={confirmRead} aria-label="Mark debtor identity notice as read">×</button>
      </div>
      <strong>Check every customer's real name and phone number.</strong>
      <p>Existing debtors may have been registered without a phone number or with only
        one name or numbers instead of a name. All staff, including the boss,
        administrators, managers and cashiers, must help correct these records.
        Before any new credit sale or debt payment, enter the customer's valid Ghana
        phone number and at least two <b>different, genuine names</b> when missing.
        Never invent names or numbers. Original receipts and debt balances are preserved.</p>
      <div className="debt-policy-announcement__actions">
        {isSpareParts && <Link to="/debts" onClick={confirmRead}>Review debtors</Link>}
        <button type="button" onClick={confirmRead}>I have read this</button>
      </div>
    </aside>
  );
}
