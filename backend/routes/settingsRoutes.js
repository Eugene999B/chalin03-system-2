const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  ensureWorkerIdentitySchema,
  normalizeEmployeePrefix,
  normalizeValidityMonths,
} = require("../services/workerIdentityService");
const {
  branchIdForUser,
  getUserSettingsSystemAdminOnly,
  isOriginalSystemAdministrator,
} = require("../services/sparePartsUserSettingsAccessService");
const {
  normalizedPhoneForStorage,
} = require("../services/loginIdentityService");
const {
  SYSTEM_ADMIN_ID,
  SYSTEM_ADMIN_USERNAME,
} = require("../security/systemAdminIdentity");

const router = express.Router();

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function cleanBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function nullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function toNonNegativeNumber(value) {
  const number = Number(value);

  if (Number.isNaN(number) || number < 0) {
    return null;
  }

  return Number(number.toFixed(2));
}

function toPositiveInt(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  return number;
}

async function logActivity(userId, branchId, action, details) {
  await pool.query(
    `INSERT INTO activity_log (branch_id, user_id, action, details)
     VALUES (?, ?, ?, ?)`,
    [branchId || null, userId || null, action, details]
  );
}

async function getBranch(branchId) {
  const [branches] = await pool.query(
    `SELECT id, code, name, location
     FROM branches
     WHERE id = ?
     LIMIT 1`,
    [branchId]
  );

  return branches[0] || null;
}

async function createDefaultSettingsForBranch(branchId) {
  await ensureWorkerIdentitySchema();
  const branch = await getBranch(branchId);

  const branchName = branch?.name || "Chalin 03 Store";
  const branchLocation = branch?.location || "Dunkwa Police Barrier";
  const branchCode = branch?.code || "CHL";

  const [result] = await pool.query(
    `INSERT INTO settings (
      branch_id,
      branch_name,
      business_name,
      business_address,
      business_phone,
      owner_phone,
      tax_rate,
      debt_reminder_days,
      daily_summary_time,
      receipt_footer,
      receipt_prefix
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      branchId,
      branchName,
      "Chalin 03 Company Limited",
      branchLocation,
      "0249469080 / 0249995510",
      "0543421127",
      0,
      30,
      "18:00:00",
      "Thank You For Coming",
      branchCode,
    ]
  );

  return result.insertId;
}

async function getSettingsForBranch(branchId) {
  await ensureWorkerIdentitySchema();
  let [settingsRows] = await pool.query(
    `SELECT
      s.*,
      b.code AS branch_code,
      b.name AS store_name,
      b.location AS store_location
     FROM settings s
     LEFT JOIN branches b ON s.branch_id = b.id
     WHERE s.branch_id = ?
     ORDER BY s.id DESC
     LIMIT 1`,
    [branchId]
  );

  if (settingsRows.length === 0) {
    await createDefaultSettingsForBranch(branchId);

    [settingsRows] = await pool.query(
      `SELECT
        s.*,
        b.code AS branch_code,
        b.name AS store_name,
        b.location AS store_location
       FROM settings s
       LEFT JOIN branches b ON s.branch_id = b.id
       WHERE s.branch_id = ?
       ORDER BY s.id DESC
       LIMIT 1`,
      [branchId]
    );
  }

  return settingsRows[0] || null;
}

// GET /api/settings
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const settings = await getSettingsForBranch(branchId);

    if (!settings) {
      return res.status(404).json({
        status: "error",
        message: "Settings record not found for the selected store.",
      });
    }

    return res.json({
      status: "success",
      branch_id: branchId,
      settings,
    });
  } catch (error) {
    console.error("Get settings error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching settings.",
    });
  }
});

// Credit settings are available only in controlled preview until enforcement is ready.
function creditSettingsAccess(req,res,next) {
  res.set("Cache-Control","no-store");
  if (process.env.CHALIN03_CREDIT_PREVIEW !== "true") {
    return res.status(404).json({status:"error",code:"CREDIT_PREVIEW_DISABLED"});
  }
  if (!isOriginalSystemAdministrator(req.user)) {
    return res.status(403).json({status:"error",message:"You are not authorized to change credit policy."});
  }
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id);
  if (!Number.isSafeInteger(branchId) || branchId <= 0) {
    return res.status(403).json({status:"error",message:"Select an authorized store first."});
  }
  req.creditSettingsBranchId = branchId;
  return next();
}

router.get("/customer-credit", requireAuth, requireRole("admin"), creditSettingsAccess, async (req,res) => {
  try {
    const [rows] = await pool.query("SELECT term_months,version FROM customer_credit_settings WHERE branch_id=?", [req.creditSettingsBranchId]);
    if (!rows.length) return res.status(503).json({status:"error",message:"Credit settings migration is not ready."});
    return res.json({status:"success",settings:{term_months:Number(rows[0].term_months),version:String(rows[0].version)},preview:true});
  } catch (error) {
    console.error("Credit settings unavailable:",error.code || error.name);
    return res.status(503).json({status:"error",message:"Credit settings are temporarily unavailable."});
  }
});

router.patch("/customer-credit", requireAuth, requireRole("admin"), creditSettingsAccess, async (req,res) => {
  const months=req.body?.term_months,version=req.body?.version;
  if (!Number.isInteger(months) || months<1 || months>12 || typeof version!=="string" || !/^[1-9][0-9]{0,18}$/.test(version)) {
    return res.status(400).json({status:"error",message:"Choose 1–12 months and refresh the current settings before saving."});
  }
  let conn;
  try {
    const {verifyStaffProtectedAction}=require("../services/staffProtectedActionService");
    const verified=await verifyStaffProtectedAction({userId:req.user.id,code:req.body?.authenticator_code});
    if (!verified.ok) return res.status(verified.status).json({status:"error",code:verified.code,message:verified.message});
    // Do not forward the one-time code into audit metadata.
    delete req.body.authenticator_code;
    conn=await pool.getConnection();
    await conn.beginTransaction();
    const [rows]=await conn.query("SELECT term_months,version FROM customer_credit_settings WHERE branch_id=? FOR UPDATE",[req.creditSettingsBranchId]);
    if (!rows.length || String(rows[0].version)!==version) {
      await conn.rollback();
      return res.status(409).json({status:"error",message:"Settings have changed. Reload before saving."});
    }
    const previous=Number(rows[0].term_months);
    await conn.query("UPDATE customer_credit_settings SET term_months=?,version=version+1,updated_by=? WHERE branch_id=?",[months,req.user.id,req.creditSettingsBranchId]);
    const {writeAuditEvent}=require("../services/auditTrailService");
    await writeAuditEvent({connection:conn,req,branchId:req.creditSettingsBranchId,action:"CUSTOMER_CREDIT_TERM_UPDATED",actionType:"CUSTOMER_CREDIT_TERM_UPDATED",entityType:"credit_settings",entityId:req.creditSettingsBranchId,workspaceCode:"spare_parts",outcome:"success",severity:"notice",metadata:{previous_term_months:previous,new_term_months:months}});
    await conn.commit();
    return res.json({status:"success",message:"Credit term saved for preview. Existing debt terms are unchanged.",settings:{term_months:months,version:(BigInt(version)+1n).toString()},preview:true});
  } catch (error) {
    if(conn) await conn.rollback();
    console.error("Credit settings update failed:",error.code || error.name);
    return res.status(503).json({status:"error",message:"Credit settings could not be saved."});
  } finally {if(conn) conn.release();}
});

// Score adjustment is an authorized human decision, not a silent algorithm.
router.patch("/customer-credit/customers/:id",requireAuth,requireRole("admin"),creditSettingsAccess,async(req,res)=>{
  const id=Number(req.params.id),score=req.body?.score,version=req.body?.version;
  const reason=typeof req.body?.reason==="string"?req.body.reason.trim():"";
  if(!Number.isSafeInteger(id)||id<=0||!Number.isInteger(score)||score<0||score>100||typeof version!=="string"||!/^[1-9][0-9]{0,18}$/.test(version)||reason.length<5||reason.length>500)return res.status(400).json({status:"error",message:"Enter a valid score, current version and evidence-based reason."});
  let conn;
  try{
    const {verifyStaffProtectedAction}=require("../services/staffProtectedActionService");
    const verified=await verifyStaffProtectedAction({userId:req.user.id,code:req.body?.authenticator_code});
    if(!verified.ok)return res.status(verified.status).json({status:"error",code:verified.code,message:verified.message});
    delete req.body.authenticator_code;
    conn=await pool.getConnection();await conn.beginTransaction();
    await conn.query("SELECT id FROM branches WHERE id=? FOR UPDATE",[req.creditSettingsBranchId]);
    const [customers]=await conn.query("SELECT id FROM customers WHERE id=? AND branch_id=? FOR UPDATE",[id,req.creditSettingsBranchId]);
    if(!customers.length){await conn.rollback();return res.status(404).json({status:"error",message:"Customer not found in this store."});}
    await conn.query("INSERT INTO customer_credit_profiles (customer_id) VALUES (?) ON DUPLICATE KEY UPDATE customer_id=customer_credit_profiles.customer_id",[id]);
    const [rows]=await conn.query("SELECT score,version FROM customer_credit_profiles WHERE customer_id=? FOR UPDATE",[id]);
    if(String(rows[0].version)!==version){await conn.rollback();return res.status(409).json({status:"error",message:"Customer credit profile changed. Reload before saving."});}
    const oldScore=Number(rows[0].score);
    if(oldScore===score){await conn.rollback();return res.json({status:"success",message:"Score unchanged.",version});}
    await conn.query("UPDATE customer_credit_profiles SET score=?,version=version+1 WHERE customer_id=?",[score,id]);
    await conn.query("INSERT INTO customer_credit_score_events (customer_id,previous_score,new_score,reason,actor_id) VALUES (?,?,?,?,?)",[id,oldScore,score,reason,req.user.id]);
    const {writeAuditEvent}=require("../services/auditTrailService");
    await writeAuditEvent({connection:conn,req,branchId:req.creditSettingsBranchId,action:"CUSTOMER_CREDIT_SCORE_UPDATED",actionType:"CUSTOMER_CREDIT_SCORE_UPDATED",entityType:"customer",entityId:id,workspaceCode:"spare_parts",outcome:"success",severity:"notice",metadata:{previous_score:oldScore,new_score:score,reason}});
    await conn.commit();return res.json({status:"success",message:"Customer credit score updated. Existing debt balances remain unchanged.",version:(BigInt(version)+1n).toString()});
  }catch(error){if(conn)await conn.rollback();console.error("Credit score update failed:",error.code||error.name);return res.status(503).json({status:"error",message:"Credit score could not be updated."});}
  finally{if(conn)conn.release();}
});

// Read-only reconciliation coverage. This is not a financial statement.
router.get("/ownership-reconciliation", requireAuth, requireRole("admin"), async (req,res)=>{
  res.set("Cache-Control","no-store");
  if(process.env.CHALIN03_OWNERSHIP_PREVIEW!=="true")return res.status(404).json({status:"error",code:"OWNERSHIP_PREVIEW_DISABLED"});
  if(!isOriginalSystemAdministrator(req.user))return res.status(403).json({status:"error",message:"Ownership reconciliation access denied."});
  const branchId=Number(req.user?.branch_id||req.user?.default_branch_id);
  if(!Number.isSafeInteger(branchId)||branchId<=0)return res.status(403).json({status:"error",message:"Select an authorized store."});
  try{
    const [rows]=await pool.query(
      `SELECT CASE WHEN o.owner_code IN ('chalin03','partner') AND o.classified_by IS NOT NULL AND CHAR_LENGTH(TRIM(COALESCE(o.evidence_reference,'')))>0 THEN o.owner_code ELSE 'unclassified' END AS owner_code,
       COUNT(*) AS line_count
       FROM sale_items si JOIN sales s ON s.id=si.sale_id
       LEFT JOIN sale_item_ownership_classifications o ON o.sale_item_id=si.id
       WHERE s.branch_id=? AND s.sale_status='completed' AND s.is_voided=0
       GROUP BY 1`,[branchId]
    );
    const groups={chalin03:0,partner:0,unclassified:0};
    for(const row of rows){const count=Number(row.line_count);if(!Object.hasOwn(groups,row.owner_code)||!Number.isSafeInteger(count)||count<0)throw Error("Invalid coverage totals");groups[row.owner_code]+=count;}
    return res.json({status:"success",scope:"completed_nonvoid_sale_lines_selected_store",groups,total:Object.values(groups).reduce((a,b)=>a+b,0),preview:true,financial_reporting_ready:false});
  }catch(error){console.error("Ownership coverage unavailable:",error.code||error.name);return res.status(503).json({status:"error",message:"Ownership reconciliation is temporarily unavailable."});}
});

// Evidence-based ownership controls. These write classification metadata only.
function ownershipPreviewAccess(req,res,next){
  res.set("Cache-Control","no-store");
  if(process.env.CHALIN03_OWNERSHIP_PREVIEW!=="true")return res.status(404).json({status:"error",code:"OWNERSHIP_PREVIEW_DISABLED"});
  return ownershipReadAccess(req,res,next);
}
function ownershipReadAccess(req,res,next){
  res.set("Cache-Control","no-store");
  if(!isOriginalSystemAdministrator(req.user))return res.status(403).json({status:"error",message:"Ownership reconciliation access denied."});
  const branchId=Number(req.user?.branch_id||req.user?.default_branch_id);
  if(!Number.isSafeInteger(branchId)||branchId<=0)return res.status(403).json({status:"error",message:"Select an authorized store."});
  req.ownershipBranchId=branchId;return next();
}
router.get("/ownership-reconciliation/financial-preview",requireAuth,requireRole("admin"),ownershipReadAccess,async(req,res)=>{
  try{
    const {readOwnershipReceiptPreview}=require("../services/ownershipReceiptPreviewService");
    return res.json({status:"success",preview:await readOwnershipReceiptPreview(pool,req.ownershipBranchId,{classificationEnabled:process.env.CHALIN03_OWNERSHIP_PREVIEW==="true"})});
  }catch(error){console.error("Ownership receipt preview failed:",error.code||error.name);return res.status(503).json({status:"error",message:"Receipt reconciliation preview unavailable."});}
});
router.get("/ownership-reconciliation/planning-scenario",requireAuth,requireRole("admin"),async(req,res)=>{
 res.set("Cache-Control","no-store");
 if(!isOriginalSystemAdministrator(req.user))return res.status(403).json({status:"error",message:"Ownership reconciliation access denied."});
 const branchId=Number(req.user?.branch_id||req.user?.default_branch_id);
 if(!Number.isSafeInteger(branchId)||branchId<=0)return res.status(403).json({status:"error",message:"Select an authorized store."});
 try{
   const {readScenario,readInitialScenario}=require("../services/managementPlanningService");
   const scenario=process.env.CHALIN03_OWNERSHIP_PREVIEW==="true"?await readScenario(pool,branchId):await readInitialScenario(pool,branchId);
    return res.json({status:"success",scenario});
 }catch(error){console.error("Sales planning scenario failed:",error.code||error.name);return res.status(503).json({status:"error",message:"Planning scenario unavailable."});}
});
router.get("/ownership-reconciliation/planning-periods",requireAuth,requireRole("admin"),ownershipReadAccess,async(req,res)=>{
 try{
   const {readPlanningPeriods}=require("../services/managementPlanningService");
   return res.json({status:"success",report:await readPlanningPeriods(pool,req.ownershipBranchId,{settingsEnabled:process.env.CHALIN03_OWNERSHIP_PREVIEW==="true"})});
 }catch(e){console.error("Planning periods unavailable:",e.code||e.name);return res.status(503).json({status:"error",message:"Planning totals unavailable."});}
});
router.get("/ownership-reconciliation/planning-periods.csv",requireAuth,requireRole("admin"),ownershipReadAccess,async(req,res)=>{
 try{
   const {readPlanningPeriods,planningPeriodsCsv}=require("../services/managementPlanningService");
   const report=await readPlanningPeriods(pool,req.ownershipBranchId,{settingsEnabled:process.env.CHALIN03_OWNERSHIP_PREVIEW==="true"});
   res.set("Content-Type","text/csv; charset=utf-8");
   res.set("Content-Disposition","attachment; filename=planning-estimates-store-"+req.ownershipBranchId+".csv");
   return res.send("\uFEFF"+planningPeriodsCsv(report));
 }catch(e){console.error("Planning export unavailable:",e.code||e.name);return res.status(503).json({status:"error",message:"Planning export unavailable."});}
});
router.get("/ownership-reconciliation/shareholder-export",requireAuth,requireRole("admin"),ownershipReadAccess,async(req,res)=>{
 try{
  const {readComparison,csv,workbook}=require("../services/shareholderExportComparison");
  const format=req.query.format||"xlsx";
  if(!["xlsx","csv"].includes(format))return res.status(400).json({status:"error",message:"Choose Excel or CSV for this comparison."});
  const report=await readComparison(pool,req.ownershipBranchId,{report:req.query.report,from:req.query.from,to:req.query.to,percent:req.query.percent,settingsEnabled:process.env.CHALIN03_OWNERSHIP_PREVIEW==="true"});
  const filename="shareholder-planning-"+report.report+"-store-"+report.branch_id+"-"+report.percent+"pct."+format;
  res.set("Content-Disposition",'attachment; filename="'+filename+'"');
  if(format==="csv"){res.set("Content-Type","text/csv; charset=utf-8");return res.send("\uFEFF"+csv(report));}
  const bytes=await workbook(report).xlsx.writeBuffer();
  res.set("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");return res.send(Buffer.from(bytes));
 }catch(e){return res.status(e.statusCode||503).json({status:"error",message:e.statusCode?e.message:"Shareholder export unavailable."});}
});
router.get("/ownership-reconciliation/shareholder-allocation",requireAuth,requireRole("admin"),ownershipReadAccess,async(req,res)=>{
 try{
  const {readShareholderAllocation,parseScenarioPercent}=require("../services/managementPlanningService");
  return res.json({status:"success",report:await readShareholderAllocation(pool,req.ownershipBranchId,{settingsEnabled:process.env.CHALIN03_OWNERSHIP_PREVIEW==="true",percent:parseScenarioPercent(req.query.percent)})});
 }catch(e){return res.status(e.statusCode||503).json({status:"error",message:e.statusCode?e.message:"Shareholder planning report unavailable."});}
});
router.get("/ownership-reconciliation/shareholder-allocation.csv",requireAuth,requireRole("admin"),ownershipReadAccess,async(req,res)=>{
 try{
  const {readShareholderAllocation,shareholderAllocationCsv,parseScenarioPercent}=require("../services/managementPlanningService");
  const report=await readShareholderAllocation(pool,req.ownershipBranchId,{settingsEnabled:process.env.CHALIN03_OWNERSHIP_PREVIEW==="true",percent:parseScenarioPercent(req.query.percent)});
  res.set("Content-Type","text/csv; charset=utf-8");
  res.set("Content-Disposition","attachment; filename=shareholder-planning-allocation-store-"+req.ownershipBranchId+".csv");
  return res.send("\uFEFF"+shareholderAllocationCsv(report));
 }catch(e){return res.status(e.statusCode||503).json({status:"error",message:e.statusCode?e.message:"Shareholder planning export unavailable."});}
});
router.patch("/ownership-reconciliation/planning-settings",requireAuth,requireRole("admin"),ownershipPreviewAccess,async(req,res)=>{
 const percent=req.body?.assumed_partner_percent,version=req.body?.version;
 if(!Number.isInteger(percent)||percent<0||percent>100||typeof version!=="string"||!/^[1-9][0-9]{0,18}$/.test(version))return res.status(400).json({status:"error",message:"Choose a whole percentage from 0 to 100 and reload current settings."});
 let conn;
 try{
   const {verifyStaffProtectedAction}=require("../services/staffProtectedActionService");
   const verified=await verifyStaffProtectedAction({userId:req.user.id,code:req.body?.authenticator_code});
   if(!verified.ok)return res.status(verified.status).json({status:"error",code:verified.code,message:verified.message});
   delete req.body.authenticator_code;
   const {readSettings}=require("../services/managementPlanningService");
   conn=await pool.getConnection();await conn.beginTransaction();
   const current=await readSettings(conn,true);
   if(current.version!==version){await conn.rollback();return res.status(409).json({status:"error",message:"Settings changed. Refresh and retry."});}
   await conn.query("UPDATE management_planning_settings SET assumed_partner_percent=?,version=version+1,updated_by=? WHERE id=1",[percent,req.user.id]);
   const {writeAuditEvent}=require("../services/auditTrailService");
   await writeAuditEvent({connection:conn,req,branchId:req.ownershipBranchId,action:"MANAGEMENT_PLANNING_ASSUMPTION_UPDATED",actionType:"MANAGEMENT_PLANNING_ASSUMPTION_UPDATED",entityType:"management_planning_settings",entityId:1,workspaceCode:"spare_parts",outcome:"success",severity:"notice",metadata:{previous_percent:current.assumed_partner_percent,new_percent:percent,scope:"company_wide_planning_only"}});
   await conn.commit();
   return res.json({status:"success",message:"Planning assumption saved for all stores. Actual records unchanged."});
 }catch(error){if(conn)await conn.rollback();console.error("Planning settings failed:",error.code||error.name);return res.status(503).json({status:"error",message:"Planning settings could not be saved."});}
 finally{if(conn)conn.release();}
});
router.get("/ownership-reconciliation/financial-preview.csv",requireAuth,requireRole("admin"),ownershipReadAccess,async(req,res)=>{
  try{
    const {readOwnershipReceiptPreview,exportReconciliationCsv}=require("../services/ownershipReceiptPreviewService");
    const report=await readOwnershipReceiptPreview(pool,req.ownershipBranchId,{classificationEnabled:process.env.CHALIN03_OWNERSHIP_PREVIEW==="true"});
    const csv=exportReconciliationCsv(report,req.ownershipBranchId);
    res.set("Content-Type","text/csv; charset=utf-8");
    res.set("Content-Disposition","attachment; filename=ownership-reconciliation-preview-store-"+req.ownershipBranchId+".csv");
    return res.send("\uFEFF"+csv);
  }catch(error){console.error("Ownership reconciliation export failed:",error.code||error.name);return res.status(503).json({status:"error",message:"Receipt reconciliation export unavailable."});}
});
router.get("/ownership-reconciliation/receipt",requireAuth,requireRole("admin"),ownershipPreviewAccess,async(req,res)=>{
  const receipt=typeof req.query.receipt==="string"?req.query.receipt.trim():"";
  if(!receipt||receipt.length>50)return res.status(400).json({status:"error",message:"Enter an exact receipt number."});
  try{
    const [rows]=await pool.query(
      `SELECT si.id,si.product_id,si.product_name,si.quantity,si.line_total,COALESCE(o.owner_code,'unclassified') AS owner_code,o.evidence_reference,COALESCE(o.version,0) AS version
       FROM sales s JOIN sale_items si ON si.sale_id=s.id LEFT JOIN sale_item_ownership_classifications o ON o.sale_item_id=si.id
       WHERE s.branch_id=? AND s.receipt_number=? AND s.sale_status='completed' AND s.is_voided=0 ORDER BY si.id`,
      [req.ownershipBranchId,receipt]);
    if(!rows.length)return res.status(404).json({status:"error",message:"No completed receipt found in this store."});
    return res.json({status:"success",receipt,items:rows.map(row=>({...row,version:String(row.version)}))});
  }catch(error){console.error("Ownership receipt lookup failed:",error.code||error.name);return res.status(503).json({status:"error",message:"Could not retrieve receipt evidence."});}
});
router.patch("/ownership-reconciliation/items/:id",requireAuth,requireRole("admin"),ownershipPreviewAccess,async(req,res)=>{
  const id=Number(req.params.id),owner=req.body?.owner_code,version=req.body?.version;
  const evidence=typeof req.body?.evidence_reference==="string"?req.body.evidence_reference.trim():"";
  if(!Number.isSafeInteger(id)||id<=0||!["chalin03","partner","unclassified"].includes(owner)||typeof version!=="string"||!/^(0|[1-9][0-9]{0,18})$/.test(version)||evidence.length<3||evidence.length>255){
    return res.status(400).json({status:"error",message:"Select an owner, provide the verified inventory or consignment reference, and reload the current item version."});
  }
  let conn;
  try{
    const {verifyStaffProtectedAction}=require("../services/staffProtectedActionService");
    const verified=await verifyStaffProtectedAction({userId:req.user.id,code:req.body?.authenticator_code});
    if(!verified.ok)return res.status(verified.status).json({status:"error",code:verified.code,message:verified.message});
    delete req.body.authenticator_code;
    conn=await pool.getConnection();await conn.beginTransaction();
    await conn.query("SELECT id FROM branches WHERE id=? FOR UPDATE",[req.ownershipBranchId]);
    const [items]=await conn.query("SELECT si.id FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.id=? AND s.branch_id=? AND s.sale_status='completed' AND s.is_voided=0 FOR UPDATE",[id,req.ownershipBranchId]);
    if(!items.length){await conn.rollback();return res.status(404).json({status:"error",message:"Eligible sale item not found in this store."});}
    const [rows]=await conn.query("SELECT owner_code,evidence_reference,version FROM sale_item_ownership_classifications WHERE sale_item_id=? FOR UPDATE",[id]);
    const prior=rows[0];
    if(String(prior?.version??0)!==version){await conn.rollback();return res.status(409).json({status:"error",message:"Classification changed. Reload the receipt."});}
    if(prior?.owner_code===owner&&prior?.evidence_reference===evidence){await conn.rollback();return res.json({status:"success",message:"Classification is already current.",version});}
    if(prior)await conn.query("UPDATE sale_item_ownership_classifications SET owner_code=?,evidence_reference=?,classified_by=?,version=version+1 WHERE sale_item_id=?",[owner,evidence,req.user.id,id]);
    else await conn.query("INSERT INTO sale_item_ownership_classifications (sale_item_id,owner_code,evidence_reference,classified_by) VALUES (?,?,?,?)",[id,owner,evidence,req.user.id]);
    await conn.query("INSERT INTO sale_item_ownership_events (sale_item_id,previous_owner,new_owner,evidence_reference,actor_id) VALUES (?,?,?,?,?)",[id,prior?.owner_code||"unclassified",owner,evidence,req.user.id]);
    const {writeAuditEvent}=require("../services/auditTrailService");
    await writeAuditEvent({connection:conn,req,branchId:req.ownershipBranchId,action:"SALE_ITEM_OWNERSHIP_CLASSIFIED",actionType:"SALE_ITEM_OWNERSHIP_CLASSIFIED",entityType:"sale_item",entityId:id,workspaceCode:"spare_parts",outcome:"success",severity:"notice",metadata:{previous_owner:prior?.owner_code||"unclassified",new_owner:owner,evidence_reference:evidence}});
    await conn.commit();
    return res.json({status:"success",message:"Ownership evidence saved. The original financial transaction is unchanged.",version:(BigInt(version)+1n).toString()});
  }catch(error){if(conn)await conn.rollback();console.error("Ownership classification failed:",error.code||error.name);return res.status(503).json({status:"error",message:"Ownership evidence could not be saved."});}
  finally{if(conn)conn.release();}
});

// GET /api/settings/user-settings-access
router.get(
  "/user-settings-access",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const branchId = branchIdForUser(req.user);
      const settings = await getSettingsForBranch(branchId);
      const systemAdminOnly = await getUserSettingsSystemAdminOnly(branchId);

      return res.json({
        status: "success",
        branch_id: branchId,
        user_settings_system_admin_only: systemAdminOnly,
        can_manage_access_control: isOriginalSystemAdministrator(req.user),
        can_access_user_settings:
          isOriginalSystemAdministrator(req.user) || !systemAdminOnly,
        settings_id: Number(settings?.id || 0) || null,
      });
    } catch (error) {
      console.error("Get User Settings access control error:", error);
      return res.status(500).json({
        status: "error",
        message: "User Settings access control could not be loaded.",
      });
    }
  }
);

// PATCH /api/settings/user-settings-access
router.patch(
  "/user-settings-access",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      if (!isOriginalSystemAdministrator(req.user)) {
        return res.status(403).json({
          status: "error",
          code: "SPARE_PARTS_USER_SETTINGS_ACCESS_CONTROL_SYSTEM_ADMIN_ONLY",
          message:
            "Only the System Administrator can change this User Settings access control.",
        });
      }

      const branchId = branchIdForUser(req.user);
      const settings = await getSettingsForBranch(branchId);
      const enabled = cleanBoolean(req.body?.user_settings_system_admin_only);

      await pool.query(
        `UPDATE settings
            SET user_settings_system_admin_only = ?
          WHERE id = ?
            AND branch_id = ?`,
        [enabled ? 1 : 0, Number(settings.id), branchId]
      );

      await logActivity(
        req.user.id,
        branchId,
        "UPDATE_SPARE_PARTS_USER_SETTINGS_ACCESS_CONTROL",
        enabled
          ? "Restricted Spare Parts User Settings access to the System Administrator."
          : "Restored Spare Parts User Settings access to other administrators."
      );

      return res.json({
        status: "success",
        branch_id: branchId,
        user_settings_system_admin_only: enabled,
        message: enabled
          ? "User Settings are now restricted to the System Administrator."
          : "User Settings are now available to other administrators.",
      });
    } catch (error) {
      console.error("Update User Settings access control error:", error);
      return res.status(500).json({
        status: "error",
        message: "User Settings access control could not be updated.",
      });
    }
  }
);

// GET /api/settings/system-admin-login-phone
router.get(
  "/system-admin-login-phone",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      if (!isOriginalSystemAdministrator(req.user)) {
        return res.status(403).json({
          status: "error",
          code: "ORIGINAL_SYSTEM_ADMINISTRATOR_REQUIRED",
          message:
            "Only the original System Administrator can view or change the protected System Administrator login phone.",
        });
      }

      const [rows] = await pool.query(
        `SELECT id, full_name, username, phone, login_phone_normalized
         FROM users
         WHERE id = ?
           AND LOWER(username) = LOWER(?)
         LIMIT 1`,
        [SYSTEM_ADMIN_ID, SYSTEM_ADMIN_USERNAME]
      );
      const administrator = rows[0];

      if (!administrator) {
        return res.status(404).json({
          status: "error",
          message: "The protected System Administrator account was not found.",
        });
      }

      return res.json({
        status: "success",
        system_admin_login_phone: administrator.phone || "",
        login_phone_normalized: administrator.login_phone_normalized || null,
      });
    } catch (error) {
      console.error("Get System Administrator login phone error:", error);
      return res.status(500).json({
        status: "error",
        message: "System Administrator login phone could not be loaded.",
      });
    }
  }
);

// PATCH /api/settings/system-admin-login-phone
router.patch(
  "/system-admin-login-phone",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      if (!isOriginalSystemAdministrator(req.user)) {
        return res.status(403).json({
          status: "error",
          code: "ORIGINAL_SYSTEM_ADMINISTRATOR_REQUIRED",
          message:
            "Only the original System Administrator can change the protected System Administrator login phone.",
        });
      }

      const phone = cleanText(req.body?.system_admin_login_phone);
      const normalizedPhone = normalizedPhoneForStorage(phone);

      if (!phone || !normalizedPhone) {
        return res.status(400).json({
          status: "error",
          message:
            "Enter a valid Ghana phone number such as 0241234567 or +233241234567.",
        });
      }

      const [duplicateRows] = await pool.query(
        `SELECT id, username
         FROM users
         WHERE login_phone_normalized = ?
           AND id <> ?
         LIMIT 1`,
        [normalizedPhone, SYSTEM_ADMIN_ID]
      );

      if (duplicateRows.length > 0) {
        return res.status(409).json({
          status: "error",
          message:
            "That phone number is already attached to another Chalin03 login account.",
        });
      }

      await pool.query(
        `UPDATE users
         SET phone = ?,
             login_phone_normalized = ?
         WHERE id = ?
           AND LOWER(username) = LOWER(?)`,
        [phone, normalizedPhone, SYSTEM_ADMIN_ID, SYSTEM_ADMIN_USERNAME]
      );

      await logActivity(
        req.user.id,
        branchIdForUser(req.user),
        "UPDATE_SYSTEM_ADMIN_LOGIN_PHONE",
        "Updated the protected System Administrator login phone. Owner security alert and receipt phone settings were not changed."
      );

      return res.json({
        status: "success",
        system_admin_login_phone: phone,
        login_phone_normalized: normalizedPhone,
        message:
          "System Administrator login phone updated. It is separate from the Owner Security Alert Phone and Business Phone / Receipt MoMo Number.",
      });
    } catch (error) {
      console.error("Update System Administrator login phone error:", error);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message:
            "That phone number is already attached to another Chalin03 login account.",
        });
      }

      return res.status(500).json({
        status: "error",
        message: "System Administrator login phone could not be updated.",
      });
    }
  }
);

// PUT /api/settings
router.put("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const branchId = getBranchId(req);

    const {
      branch_name,
      business_name,
      business_address,
      business_phone,
      owner_phone,
      tax_rate,
      debt_reminder_days,
      daily_summary_time,
      receipt_footer,
      receipt_prefix,
      worker_id_card_validity_months,
      worker_employee_number_prefix,
    } = req.body;

    const cleanBusinessName = cleanText(business_name);
    const cleanBranchName = cleanText(branch_name);

    if (!cleanBusinessName) {
      return res.status(400).json({
        status: "error",
        message: "Business name is required.",
      });
    }

    const taxRate = toNonNegativeNumber(tax_rate ?? 0);
    const reminderDays = toPositiveInt(Number(debt_reminder_days ?? 30));
    const cardValidityMonths = normalizeValidityMonths(
      Number(worker_id_card_validity_months ?? 24)
    );
    const employeeNumberPrefix = normalizeEmployeePrefix(
      worker_employee_number_prefix
    );

    if (taxRate === null) {
      return res.status(400).json({
        status: "error",
        message: "Tax rate must be a valid number.",
      });
    }

    if (reminderDays === null) {
      return res.status(400).json({
        status: "error",
        message: "Debt reminder days must be a positive whole number.",
      });
    }

    let [settingsRows] = await pool.query(
      `SELECT id
       FROM settings
       WHERE branch_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [branchId]
    );

    if (settingsRows.length === 0) {
      await createDefaultSettingsForBranch(branchId);

      [settingsRows] = await pool.query(
        `SELECT id
         FROM settings
         WHERE branch_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [branchId]
      );
    }

    const settingsId = settingsRows[0].id;

    await pool.query(
      `UPDATE settings
       SET branch_name = ?,
           business_name = ?,
           business_address = ?,
           business_phone = ?,
           owner_phone = ?,
           tax_rate = ?,
           debt_reminder_days = ?,
           daily_summary_time = ?,
           receipt_footer = ?,
           receipt_prefix = ?,
           worker_id_card_validity_months = ?,
           worker_employee_number_prefix = ?
       WHERE id = ?
       AND branch_id = ?`,
      [
        cleanBranchName || null,
        cleanBusinessName,
        nullableText(business_address),
        nullableText(business_phone),
        nullableText(owner_phone),
        taxRate,
        reminderDays,
        daily_summary_time || "18:00:00",
        nullableText(receipt_footer),
        nullableText(receipt_prefix),
        cardValidityMonths,
        employeeNumberPrefix,
        settingsId,
        branchId,
      ]
    );

    // Worker identity rules are group-wide so every workspace generates consistent cards.
    await pool.query(
      `UPDATE settings
       SET worker_id_card_validity_months = ?,
           worker_employee_number_prefix = ?`,
      [cardValidityMonths, employeeNumberPrefix]
    );

    /*
      Keep the store name/address in the branches table close to the settings.
      This helps the login store selector and receipt header stay consistent.
    */
    if (cleanBranchName || cleanText(business_address)) {
      await pool.query(
        `UPDATE branches
         SET name = COALESCE(?, name),
             location = COALESCE(?, location)
         WHERE id = ?`,
        [
          cleanBranchName || null,
          nullableText(business_address),
          branchId,
        ]
      );
    }

    await logActivity(
      req.user.id,
      branchId,
      "UPDATE_SETTINGS",
      "Updated selected store settings"
    );

    const updatedSettings = await getSettingsForBranch(branchId);

    return res.json({
      status: "success",
      branch_id: branchId,
      message: "Settings updated successfully.",
      settings: updatedSettings,
    });
  } catch (error) {
    console.error("Update settings error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while updating settings.",
    });
  }
});

module.exports = router;
