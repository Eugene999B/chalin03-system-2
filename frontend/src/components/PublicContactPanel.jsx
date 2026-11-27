import {useState} from "react";
import axiosClient from "../api/axiosClient";
import "../styles/publicContactPanel.css";

const blank={customer_name:"",customer_phone:"",customer_location:"",customer_email:"",message:"",website:""};
const requestKey=()=>globalThis.crypto?.randomUUID?.()||
 ("e95f9365-6ca0-44a3-8661-"+Math.random().toString(16).slice(2).padEnd(12,"0").slice(0,12));

/** This is an asynchronous website enquiry, not a misleading live-chat promise. */
export default function PublicContactPanel({subject="General enquiry",inline=false,whatsAppUrl="https://wa.me/233540713654"}){
 const [open,setOpen]=useState(false);
 const [fields,setFields]=useState(blank);
 const [requestId,setRequestId]=useState(requestKey);
 const [reference,setReference]=useState("");
 const [sending,setSending]=useState(false);
 const [error,setError]=useState("");
 const update=(name,value)=>setFields(current=>({...current,[name]:value}));
 async function submit(event){
  event.preventDefault();
  if(sending)return;
  setSending(true);setError("");
  try{
   const {data}=await axiosClient.post("/public-commerce/requests",{
    ...fields,subject,request_type:"message",client_key:requestId
   },{timeout:16000});
   setReference(data.reference||"Received");setFields(blank);setRequestId(requestKey());
  }catch(e){setError(e.response?.data?.message||"Message not sent. Please call or use WhatsApp us instead.");}
  finally{setSending(false);}
 }
 return <div className={inline?"public-contact public-contact--inline":"public-contact"} data-testid="public-message-us">
  {(inline||open)?<section className="public-contact__panel" role={inline?undefined:"dialog"} aria-modal={inline?undefined:"false"} aria-label="Message the CHALIN03 team">
   <div className="public-contact__head"><div><span>CHALIN03 CUSTOMER CARE</span><strong>Message our team</strong>
    <p>Send us a question. Our staff will follow up using the contact details you provide.</p></div>
    {!inline?<button type="button" onClick={()=>setOpen(false)} aria-label="Close message form">×</button>:null}</div>
   {reference?<div className="public-contact__success" role="status"><strong>Message received</strong>
     <p>Reference: {reference}. Keep this number for follow-up.</p>
     <button type="button" onClick={()=>{setReference("");setError("");}}>Send another message</button></div>:
    <form onSubmit={submit}>
     <label>Full name<input required minLength={2} maxLength={150} autoComplete="name"
      value={fields.customer_name} onChange={e=>update("customer_name",e.target.value)}/></label>
     <label>Phone / WhatsApp<input required type="tel" autoComplete="tel" maxLength={32}
      value={fields.customer_phone} onChange={e=>update("customer_phone",e.target.value)}/></label>
     <label>Town / location<input required minLength={2} maxLength={255} autoComplete="address-level2"
      value={fields.customer_location} onChange={e=>update("customer_location",e.target.value)}/></label>
     <label>Your message<textarea required rows={3} minLength={5} maxLength={3500}
      placeholder="What would you like us to help you with?"
      value={fields.message} onChange={e=>update("message",e.target.value)}/></label>
     <label className="public-contact__honeypot" aria-hidden="true">Website<input tabIndex={-1}
      autoComplete="off" value={fields.website} onChange={e=>update("website",e.target.value)}/></label>
     {error?<p className="public-contact__error" role="alert">{error}</p>:null}
     <button className="public-contact__submit" type="submit" disabled={sending}>
      {sending?"Sending message…":"Send message"}</button>
     <small>No online payment or instant reply is promised. For urgent enquiries, call or WhatsApp us.</small>
    </form>}
   <div className="public-contact__links">
    <a href="tel:+233540713654">Call us</a>
    <a href={whatsAppUrl} target="_blank" rel="noopener noreferrer">WhatsApp us</a>
   </div>
  </section>:null}
  {!inline?<button className="public-contact__trigger" type="button" aria-expanded={open}
    aria-label={open?"Close customer message form":"Message CHALIN03 customer service"}
    onClick={()=>setOpen(value=>!value)}>
   <span aria-hidden="true">✉</span><span>{open?"Close":"Message us"}</span>
  </button>:null}
 </div>;
}
