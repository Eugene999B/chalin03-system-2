import {test,expect} from "@playwright/test";
const workspace={id:1,code:"spare_parts",name:"Spare Parts"};
const user={id:12,username:"presentation-qa-manager",full_name:"Synthetic Presentation Manager",
  role:"admin",access_role:"admin",workspace_role:"admin",workspace_code:"spare_parts",
  active_workspace:workspace,branch_id:1,default_branch_id:1,branch_code:"SP01",
  branch_name:"Synthetic Test Spare Parts",selected_branch:{id:1,code:"SP01",name:"Synthetic Test Spare Parts"},
  effective_permissions:["reports.view","audit.view","exports.view"]};
function json(route,data,status=200){return route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});}
const preview={
  status:"success",
  scope:{branch:"SP01 - Synthetic Test Spare Parts",branch_id:1,from:"2026-11-01",to:"2026-11-17"},
  summary:{invoiceTotal:90240,collectedAtSale:60400,debtCollected:12850,
    openDebtTotal:41150,overdueTotal:10900,supplierPayablesTotal:7300,refundTotal:550},
  charts:[
    {title:"Daily completed invoice value",note:"By original sale date",kind:"line",points:[
      {label:"11-01",value:12000},{label:"11-04",value:15350},{label:"11-09",value:9400},{label:"11-17",value:23500}]},
    {title:"Top selling parts",note:"Sales before tax",kind:"bar",points:[
      {label:"Hydraulic pump",value:25500},{label:"Engine filter",value:18700}]},
    {title:"Recorded receipts and refunds",note:"Source payment entries",kind:"bar",points:[
      {label:"Paid at sale",value:60400},{label:"Debt repayments",value:12850},{label:"Refunds paid",value:550}]},
    {title:"Current debt by due-date age",note:"Current snapshot",kind:"bar",points:[
      {label:"1–30 overdue",value:9100},{label:"31–60 overdue",value:1800}]},
    {title:"Supplier invoices and recorded payments",note:"Distinct date bases",kind:"bar",points:[
      {label:"Purchase invoices",value:18000},{label:"Supplier payments",value:12000}]},
  ],
  findings:[{priority:"HIGH",area:"Collections",observation:"GHS 10,900 is overdue",
    action:"Review original debt statements before customer follow-up",evidence:"debts.due_date"}],
  narrative:[{topic:"Sales performance",explanation:"Completed invoices are not cash received."},
    {topic:"Customer debt",explanation:"Current outstanding includes earlier periods."}],
  warning:"Synthetic test data: not audited"
};
async function prepare(page){
  await page.addInitScript((account)=>{
    localStorage.setItem("chalin03_token","synthetic-presentation-only");
    localStorage.setItem("chalin03_user",JSON.stringify(account));
  },user);
  await page.route("http://api.test/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname.replace(/^\/api/,"");
    if(pathname==="/auth/me")return json(route,{status:"success",user,workspace});
    if(pathname==="/exports/business-intelligence/preview")return json(route,preview);
    if(pathname==="/workspace-context/options")return json(route,{status:"success",managed_workspace:false,automatic_access:true,contexts:[]});
    // Secondary legacy widgets must never mutate live state in these tests.
    if(route.request().method()!=="GET")return json(route,{status:"error",message:"Synthetic browser test is read-only"},405);
    return json(route,{status:"success",summary:{},products:[],top_products:[],
      payment_breakdown:[],intelligence:{scope:{},executive_summary:{},audit:{}},
      signoffs:[],data:[],rows:[],history:[]});
  });
}
async function studioFits(page){
  const info=await page.locator(".rpt-studio").evaluate(el=>{
    const box=el.getBoundingClientRect();return {left:box.left,right:box.right,viewport:document.documentElement.clientWidth};
  });
  expect(info.left).toBeGreaterThanOrEqual(-1);
  expect(info.right).toBeLessThanOrEqual(info.viewport+1);
}
test("desktop Reports is a visual management presentation with real rendered series",async({page},testInfo)=>{
  await page.setViewportSize({width:1440,height:900});await prepare(page);await page.goto("/reports");
  await expect(page.locator(".rpt-studio")).toBeVisible();
  await expect(page.getByRole("heading",{name:"Business reports."})).toBeVisible();
  await page.getByRole("button",{name:/Analyse store/i}).click();
  await expect(page.locator(".rpt-kpi-grid article")).toHaveCount(6);
  await expect(page.locator(".rpt-line-svg, .rpt-trend-card svg")).toBeVisible();
  await page.getByRole("tab",{name:"Collections"}).click();
  await expect(page.getByText("Current debt by due-date age")).toBeVisible();
  await expect(page.getByRole("button",{name:/Download Complete business review as PDF/i})).toBeVisible();
  await studioFits(page);
  await page.screenshot({path:testInfo.outputPath("reports-desktop.png"),fullPage:true});
});
test("mobile Reports keeps chart controls and downloadable editions inside viewport",async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});await prepare(page);await page.goto("/reports");
  await expect(page.locator(".rpt-studio")).toBeVisible();
  await page.getByRole("button",{name:/Analyse store/i}).click();
  await expect(page.locator(".rpt-kpi-grid article")).toHaveCount(6);
  const columns=await page.locator(".rpt-kpi-grid").evaluate(el=>getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/));
  expect(columns).toHaveLength(2);
  await studioFits(page);
  const button=page.getByRole("button",{name:/Download Complete business review as Word/i});
  const box=await button.boundingBox();
  expect(box).not.toBeNull();expect(box.height).toBeGreaterThanOrEqual(40);
  await page.screenshot({path:testInfo.outputPath("reports-mobile.png"),fullPage:true});
});
test("download centre shows separate editorial publications and operational archive",async({page},testInfo)=>{
  await page.setViewportSize({width:1440,height:900});await prepare(page);await page.goto("/exports");
  await expect(page.getByRole("heading",{name:"Business reports. Built to explain."})).toBeVisible();
  await expect(page.locator(".ec-publication")).toHaveCount(5);
  await expect(page.locator(".ec-operational-grid .ec-report-card").first()).toBeVisible();
  await expect(page.getByRole("button",{name:/Analyse this store/i})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("download-library-desktop.png"),fullPage:true});
});
test("mobile Export Centre keeps format buttons tappable and cover cards readable",async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});await prepare(page);await page.goto("/exports");
  await expect(page.locator(".ec-publication")).toHaveCount(5);
  const box=await page.locator(".ec-publication-formats button").first().boundingBox();
  expect(box).not.toBeNull();expect(box.height).toBeGreaterThanOrEqual(44);
  const cover=await page.locator(".ec-publication").first().boundingBox();
  expect(cover.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:testInfo.outputPath("download-library-mobile.png"),fullPage:true});
});
