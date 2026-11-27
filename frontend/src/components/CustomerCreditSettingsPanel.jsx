import {useEffect,useState} from "react";
import axiosClient from "../api/axiosClient";
import "../styles/customerCreditProfile.css";

export default function CustomerCreditSettingsPanel(){
  const [settings,setSettings]=useState(null);
  const [term,setTerm]=useState("1");
  const [code,setCode]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [unavailable,setUnavailable]=useState(false);
  const [reload,setReload]=useState(0);
  useEffect(()=>{
    let active=true;
    axiosClient.get("/settings/customer-credit").then(({data})=>{
      if(active){setSettings(data.settings);setTerm(String(data.settings.term_months));setUnavailable(false);setError("");}
    }).catch(e=>{
      if(active){if(e.response?.status===404||e.response?.status===403)setUnavailable(true);else setError(e.response?.data?.message||"Credit settings could not be loaded.");}
    });
    return ()=>{active=false;};
  },[reload]);
  async function save(event){
    event.preventDefault();if(busy||!settings||!/^\d{6}$/.test(code))return;
    setBusy(true);setError("");setMessage("");
    try{
      const {data}=await axiosClient.patch("/settings/customer-credit",{term_months:Number(term),version:settings.version,authenticator_code:code});
      setSettings(data.settings);setTerm(String(data.settings.term_months));setMessage(data.message);
    }catch(e){setError(e.response?.data?.message||"Could not save credit settings.");}
    finally{setCode("");setBusy(false);}
  }
  if(unavailable)return null;
  if(!settings)return error?<section className="ccp"><p role="alert">{error}</p><button type="button" onClick={()=>setReload(x=>x+1)}>Retry</button></section>:null;
  return <section className="ccp">
    <div className="ccp-heading"><div><small>CHALIN03 · CREDIT INTELLIGENCE</small><h3>Debt credit settings</h3></div><span className="ccp-preview">Preview</span></div>
    <p>Set the default repayment term for new debt items. Historical due dates remain unchanged. This preview does not yet enforce sales credit policy.</p>
    <form onSubmit={save} className="ccp-settings-form">
      <label>Default repayment term<select value={term} onChange={e=>setTerm(e.target.value)} disabled={busy}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1} {i===0?"calendar month":"calendar months"}</option>)}</select></label>
      <label>Authenticator code<input type="text" inputMode="numeric" autoComplete="off" maxLength={6} pattern="[0-9]{6}" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} required disabled={busy}/></label>
      <div><button type="submit" disabled={busy||term===String(settings.term_months)||code.length!==6}>{busy?"Saving…":"Verify and save"}</button> <button type="button" disabled={busy} onClick={()=>{setCode("");setMessage("");setReload(x=>x+1);}}>Reload settings</button></div>
    </form>
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
