import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=(path)=>readFileSync(resolve(root,path),"utf8");
const desk=read("src/pages/LegacyDebtsPage.jsx");
const editor=read("src/components/CustomerIdentityEditorPanel.jsx");
const notice=read("src/components/DebtorIdentityStaffAnnouncement.jsx");
const noticeCss=read("src/components/DebtorIdentityStaffAnnouncement.css");
const debtCss=read("src/styles/debtDesk.css");
const app=read("src/App.jsx");
const assertHas=(src,pattern,message)=>assert.match(src,pattern,message);
for(const term of [
  /needs_identity/,
  /Missing details/,
  /identity_requirements/,
  /customer_name:identityName/,
  /customer_phone:identityPhone/,
  /Complete debtor details now/,
  /Save verified details/,
  /submitIdentityCorrection/,
  /identityValid &&/,
  /identityMissing=/,
  /debt_customer_name_snapshot/,
  /master_customer_name/,
]){
  assertHas(desk,term,"Debt Desk contract missing "+term);
}
assertHas(editor,/alphabetic\.length<2/);
assertHas(editor,/New customer|two different real names|two different/i);
assertHas(notice,/CHALIN03 · IMPORTANT STAFF NOTICE/);
assertHas(notice,/All staff, including the boss/);
assertHas(notice,/Never invent names or numbers/);
assertHas(notice,/isLoggedIn/);
assertHas(notice,/acknowledged/);
assertHas(app,/<DebtorIdentityStaffAnnouncement \/>/);
assertHas(noticeCss,/@media\(max-width:600px\)/);
assertHas(noticeCss,/max-height:calc\(100dvh/);
assertHas(debtCss,/debt-desk__missing-identity-callout/);
assertHas(debtCss,/debt-desk__identity-update/);
assertHas(debtCss,/@media\(max-width:650px\)/);
console.log("Debtor identity reminder, payment UX and account-wide staff notice contracts passed.");
