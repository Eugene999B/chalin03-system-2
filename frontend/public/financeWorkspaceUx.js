(() => {
  const STYLE_ID = "chalin03-finance-workspace-ux-v1";
  const ROOT_ATTR = "data-chalin03-finance-workspace-ux";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .c03-finance-ux-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.55rem;margin:1rem 0;padding:.72rem;border:1px solid rgba(22,68,49,.13);border-radius:16px;background:rgba(255,255,255,.86);box-shadow:0 8px 24px rgba(14,49,34,.05);position:sticky;top:10px;z-index:20;backdrop-filter:blur(12px)}
      .c03-finance-ux-title{font-size:.74rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#176747;margin-right:auto}
      .c03-finance-ux-btn{border:1px solid rgba(22,68,49,.16);background:#fffdf8;color:#17352a;border-radius:11px;padding:.56rem .78rem;min-height:38px;font:inherit;font-size:.78rem;font-weight:800;cursor:pointer;text-decoration:none}
      .c03-finance-ux-btn:hover{border-color:#176747;transform:translateY(-1px)}
      .c03-finance-ux-panel{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem;margin:0 0 1rem}
      .c03-finance-ux-card{padding:.9rem 1rem;border-radius:15px;border:1px solid rgba(22,68,49,.12);background:linear-gradient(135deg,#fffefa,#f6f3ea);box-shadow:0 7px 20px rgba(20,56,41,.04)}
      .c03-finance-ux-card strong{display:block;font-size:.9rem;color:#17352a;margin-bottom:.3rem}.c03-finance-ux-card span{display:block;color:#65736b;font-size:.8rem;line-height:1.55}
      .c03-finance-ux-risk{border-left:4px solid #a96e12}.c03-finance-ux-good{border-left:4px solid #237451}.c03-finance-ux-neutral{border-left:4px solid #386f91}
      .c03-finance-ux-steps{display:flex;gap:.45rem;overflow:auto;padding:.15rem 0 .3rem;margin-bottom:.8rem}.c03-finance-ux-step{white-space:nowrap;border:1px solid rgba(22,68,49,.12);background:#fffdf8;border-radius:999px;padding:.48rem .72rem;font-size:.76rem;font-weight:850;color:#355449;cursor:pointer}.c03-finance-ux-step.is-active{background:#176747;color:#fff;border-color:#176747}.c03-finance-ux-step.is-done{border-color:#237451;color:#237451}
      .c03-finance-ux-sticky{position:sticky;bottom:10px;z-index:25;margin-top:1rem;padding:.7rem .8rem;border-radius:15px;background:rgba(7,22,13,.93);color:#fff;display:flex;flex-wrap:wrap;align-items:center;gap:.55rem;box-shadow:0 18px 45px rgba(0,0,0,.2)}
      .c03-finance-ux-sticky span{font-size:.78rem;font-weight:750;margin-right:auto}.c03-finance-ux-sticky a,.c03-finance-ux-sticky button{min-height:40px;border-radius:10px;border:1px solid rgba(255,255,255,.22);padding:.5rem .75rem;background:rgba(255,255,255,.08);color:#fff;font:inherit;font-size:.76rem;font-weight:850;text-decoration:none;cursor:pointer}
      @media(max-width:900px){.c03-finance-ux-panel{grid-template-columns:1fr}.c03-finance-ux-bar{top:4px}}
      @media(prefers-reduced-motion:reduce){.c03-finance-ux-btn:hover{transform:none}}
    `;
    document.head.appendChild(style);
  }

  function makeButton(label, onClick, className="c03-finance-ux-btn") {
    const button=document.createElement("button");
    button.type="button"; button.className=className; button.textContent=label; button.addEventListener("click",onClick); return button;
  }

  function addBar(main, config) {
    if (main.querySelector(".c03-finance-ux-bar")) return;
    const bar=document.createElement("div"); bar.className="c03-finance-ux-bar";
    const title=document.createElement("span"); title.className="c03-finance-ux-title"; title.textContent=config.title; bar.appendChild(title);
    for(const item of config.items){
      if(item.href){const a=document.createElement("a");a.className="c03-finance-ux-btn";a.href=item.href;a.textContent=item.label;bar.appendChild(a);}
      else bar.appendChild(makeButton(item.label,item.onClick));
    }
    main.insertBefore(bar,main.firstElementChild?.nextElementSibling || main.firstChild);
  }

  function addCorrectionsExperience(main){
    addBar(main,{title:"Correction workspace",items:[
      {label:"Overview",onClick:()=>window.scrollTo({top:0,behavior:"smooth"})},
      {label:"New correction",onClick:()=>document.querySelector("form")?.scrollIntoView({behavior:"smooth",block:"start"})},
      {label:"Policy",onClick:()=>{const el=[...document.querySelectorAll("button,a")].find(n=>/view policy/i.test(n.textContent||""));el?.click();}},
      {label:"Finance Home",href:"/equipment-installment-finance"}
    ]});
    const panel=document.createElement("div");panel.className="c03-finance-ux-panel";
    const cards=[
      ["Prepare with evidence","Choose the account, identify the correction, record the evidence reference, and preview the financial impact before submitting.","c03-finance-ux-neutral"],
      ["Preview before approval","Use the settlement preview to see the expected balance movement and customer refund position before a request is approved.","c03-finance-ux-good"],
      ["Decision is separate","The independent decision stage should explain why the correction is approved or rejected; the ledger remains the authoritative record.","c03-finance-ux-risk"]
    ];
    cards.forEach(([h,t,c])=>{const d=document.createElement("div");d.className=`c03-finance-ux-card ${c}`;d.innerHTML=`<strong>${h}</strong><span>${t}</span>`;panel.appendChild(d)});
    const anchor=main.querySelector(".finance-corrections__metrics")||main.querySelector(".finance-corrections__workspace"); if(anchor) anchor.parentNode.insertBefore(panel,anchor); 
  }

  function addProfilesExperience(main){
    addBar(main,{title:"Customer portfolio",items:[
      {label:"Customer search",onClick:()=>main.querySelector('input[aria-label="Search Finance customers"]')?.focus()},
      {label:"Overdue only",onClick:()=>{const s=main.querySelector('select[aria-label="Filter customer portfolio status"]');if(s){s.value="overdue";s.dispatchEvent(new Event("change",{bubbles:true}));}}},
      {label:"Active only",onClick:()=>{const s=main.querySelector('select[aria-label="Filter customer portfolio status"]');if(s){s.value="active";s.dispatchEvent(new Event("change",{bubbles:true}));}}},
      {label:"Finance Home",href:"/equipment-installment-finance"}
    ]});
    const panel=document.createElement("div");panel.className="c03-finance-ux-panel";
    const cards=[
      ["Start with the exposure","Outstanding and overdue amounts are shown before the detailed file so a reviewer can identify priority customers quickly.","c03-finance-ux-risk"],
      ["Drill down only when needed","Select a customer to open the full profile, agreements, payments, schedule and KYC details without cluttering the initial view.","c03-finance-ux-neutral"],
      ["Act from the profile","Record a payment, open the account, review case history, or start a new installment directly from the customer file.","c03-finance-ux-good"]
    ];
    cards.forEach(([h,t,c])=>{const d=document.createElement("div");d.className=`c03-finance-ux-card ${c}`;d.innerHTML=`<strong>${h}</strong><span>${t}</span>`;panel.appendChild(d)});
    const anchor=main.querySelector(".finance-accounts__metrics");if(anchor)anchor.parentNode.insertBefore(panel,anchor.nextSibling);
  }

  function addStartExperience(main){
    const sections=[...main.querySelectorAll(".finance-profile__section")];
    if(!sections.length)return;
    const nav=document.createElement("div");nav.className="c03-finance-ux-steps";
    sections.forEach((section,i)=>{const heading=section.querySelector("h3")?.textContent?.trim()||`Step ${i+1}`;const b=document.createElement("button");b.type="button";b.className="c03-finance-ux-step";b.textContent=`${i+1}. ${heading}`;b.addEventListener("click",()=>section.scrollIntoView({behavior:"smooth",block:"start"}));nav.appendChild(b);});
    const hero=main.querySelector(".finance-profile__hero");if(hero)hero.insertAdjacentElement("afterend",nav);
    const update=()=>{sections.forEach((section,i)=>{const fields=[...section.querySelectorAll("input,select,textarea")].filter(e=>e.type!=="hidden");const filled=fields.filter(e=>e.type==="checkbox"?e.checked:String(e.value||"").trim()!=="").length;nav.children[i]?.classList.toggle("is-done",fields.length>0 && filled===fields.length);});};
    main.addEventListener("input",update);main.addEventListener("change",update);update();
    const sticky=document.createElement("div");sticky.className="c03-finance-ux-sticky";const text=document.createElement("span");text.textContent="Keep the application moving: save the profile, then continue through the guided Finance steps.";sticky.appendChild(text);
    const save=[...main.querySelectorAll("button")].find(b=>/save.*profile/i.test(b.textContent||""));if(save){const clone=save.cloneNode(true);clone.addEventListener("click",()=>save.click());sticky.appendChild(clone)}
    const financeHome=document.createElement("a");financeHome.href="/equipment-installment-finance";financeHome.textContent="Finance Home";sticky.appendChild(financeHome);main.appendChild(sticky);
  }

  function boot(){
    injectStyles();
    const corrections=document.querySelector('[data-testid="phase4-corrections-page"]');
    const profiles=document.querySelector('[data-testid="finance-customer-portfolios"]');
    const start=document.querySelector(".finance-profile");
    if(corrections&&!corrections.hasAttribute(ROOT_ATTR)){addCorrectionsExperience(corrections);corrections.setAttribute(ROOT_ATTR,"1");}
    if(profiles&&!profiles.hasAttribute(ROOT_ATTR)){addProfilesExperience(profiles);profiles.setAttribute(ROOT_ATTR,"1");}
    if(start&&!start.hasAttribute(ROOT_ATTR)){addStartExperience(start);start.setAttribute(ROOT_ATTR,"1");}
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
  new MutationObserver(()=>boot()).observe(document.body,{childList:true,subtree:true});
})();
