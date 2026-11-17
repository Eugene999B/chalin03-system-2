import {useMemo, useState} from "react";
import {SPARE_PARTS_PAGES,actualPageAccess} from "../security/sparePartsPageAccess";
import "../styles/pageAccessMatrix.css";

// This screen uses the existing protected, audited permission override endpoint.
// It does not invent a second store for permissions or override a role/security gate.
export default function PageAccessMatrix({
  state, selectedUser, detailLoading, tokenReady, actionLoading,
  onAllow, onBlock, onReset,
}) {
  const [query,setQuery] = useState("");
  const [group,setGroup] = useState("all");
  const [filter,setFilter] = useState("all");
  const role=String(state?.workspace_role || selectedUser?.role || "").toLowerCase();
  const owner=Boolean(selectedUser?.is_original_system_administrator);
  const effective=useMemo(()=>
    SPARE_PARTS_PAGES.map(page=>({
      ...page,
      access:actualPageAccess(page,state,role,owner),
      override:state?.active_overrides?.find(item=>item.permission_code===page.permission)||null,
    })),[state,role,owner]);
  const allowedCount=effective.filter(page=>page.access.allowed).length;
  const groups=[...new Set(SPARE_PARTS_PAGES.map(page=>page.group))];
  const visible=effective.filter(page=>{
    if(group!=="all"&&page.group!==group)return false;
    if(filter==="allowed"&&!page.access.allowed)return false;
    if(filter==="blocked"&&page.access.allowed)return false;
    return !query.trim()||[page.label,page.group,page.path].join(" ").toLowerCase().includes(query.trim().toLowerCase());
  });
  const locked=Boolean(actionLoading)||!tokenReady||detailLoading||!selectedUser;
  return (
    <section className="pam" aria-label="Access by page">
      <header className="pam-heading">
        <div>
          <p className="pam-eyebrow">Clear access decisions</p>
          <h2>Which pages can this person open?</h2>
          <p>Select any page to allow it, block it, or restore the role default. Page access never gives permission to take an action that the role or API forbids.</p>
        </div>
        <div className="pam-totals" aria-label="Page access totals">
          <span><strong>{allowedCount}</strong> Allowed</span>
          <span><strong>{effective.length-allowedCount}</strong> Blocked</span>
        </div>
      </header>
      <div className="pam-filters">
        <label>Find a page
          <input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Sales, debts, reports..." />
        </label>
        <label>Page group
          <select value={group} onChange={event=>setGroup(event.target.value)}>
            <option value="all">All page groups</option>
            {groups.map(name=><option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>Current access
          <select value={filter} onChange={event=>setFilter(event.target.value)}>
            <option value="all">All pages</option>
            <option value="allowed">Allowed pages</option>
            <option value="blocked">Blocked pages</option>
          </select>
        </label>
      </div>
      {!tokenReady&&<p className="pam-instruction">To change access, unlock protected actions above and enter a reason. You can review the pages without unlocking.</p>}
      {detailLoading&&<p role="status">Checking this user's current access...</p>}
      <div className="pam-grid">
        {visible.map(page=>{
          const baseBlocked=!page.access.roleEligible||!page.access.featureEligible;
          const busy=actionLoading?.startsWith(page.permission+":");
          const overrideLabel=page.override
            ? "Individual "+(page.override.effect==="allow"?"allow":"block")
            : "Inherited from role";
          const disableAllow=locked||owner||baseBlocked||page.access.allowed;
          const disableBlock=locked||owner||!page.access.allowed&&!page.override;
          return <article className={"pam-card "+(page.access.allowed?"is-allowed":"is-blocked")} key={page.id}>
            <div className="pam-card-top">
              <span className="pam-group">{page.group}</span>
              <span className={"pam-state "+(page.access.allowed?"is-allowed":"is-blocked")}>
                {page.access.allowed?"✓ Allowed":"⊘ Blocked"}
              </span>
            </div>
            <h3>{page.label}</h3>
            <p className="pam-path">{page.path}</p>
            <p className="pam-explanation">{page.access.explanation}</p>
            <span className="pam-source">{overrideLabel}{page.override?.expires_at?" · Expires "+new Date(page.override.expires_at).toLocaleDateString("en-GB"):""}</span>
            <div className="pam-actions">
              <button type="button" className="pam-allow"
                disabled={disableAllow}
                title={baseBlocked?"The role or feature permission must be corrected before allowing this page.":"Allow this page"}
                onClick={()=>onAllow(page.permission)}>{busy?"Saving...":"Allow"}</button>
              <button type="button" className="pam-block"
                disabled={disableBlock}
                onClick={()=>onBlock(page.permission)}>{busy?"Saving...":"Block"}</button>
              <button type="button" className="pam-reset"
                disabled={locked||owner||!page.override}
                onClick={()=>onReset(page.permission)}>Role default</button>
            </div>
          </article>;
        })}
      </div>
      {!visible.length&&<p className="pam-empty">No pages match these filters.</p>}
      <p className="pam-footnote">A blocked page disappears from desktop and mobile navigation, and a direct link is blocked. Role restrictions, assigned store access and server-side action permissions still apply. The original System Administrator cannot lose protected access.</p>
    </section>
  );
}
