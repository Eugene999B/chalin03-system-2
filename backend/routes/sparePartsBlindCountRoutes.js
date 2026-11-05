"use strict";
const express=require("express");
const {pool}=require("../config/db");
const {requireRole}=require("../middleware/roleMiddleware");
const {analyzeLines,exportCount,validInt}=require("../services/sparePartsBlindCountAnalysis");
const router=express.Router();
router.use(requireRole("admin","manager","auditor"));

let schemaPromise;
function ready(){
  if(!schemaPromise) schemaPromise=(async()=>{
    await pool.query([
      "CREATE TABLE IF NOT EXISTS spare_parts_blind_counts (",
      "id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,",
      "branch_id INT NOT NULL,",
      "title VARCHAR(150) NOT NULL,",
      "status ENUM('draft','submitted','reviewed') NOT NULL DEFAULT 'draft',",
      "created_by INT NOT NULL,submitted_by INT NULL,reviewed_by INT NULL,",
      "review_notes VARCHAR(2000) NULL,",
      "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,",
      "submitted_at DATETIME NULL,reviewed_at DATETIME NULL,",
      "INDEX idx_blind_branch (branch_id,created_at),",
      "INDEX idx_blind_status (branch_id,status)",
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    ].join(" "));
    await pool.query([
      "CREATE TABLE IF NOT EXISTS spare_parts_blind_count_items (",
      "count_id BIGINT UNSIGNED NOT NULL,product_id INT NOT NULL,",
      "product_name VARCHAR(250) NOT NULL,product_size VARCHAR(160) NULL,",
      "category VARCHAR(160) NULL,barcode VARCHAR(160) NULL,",
      "expected_qty INT NOT NULL,unit_cost DECIMAL(14,2) NOT NULL,",
      "unit_price DECIMAL(14,2) NOT NULL,",
      "counted_qty INT NULL,system_qty_at_submit INT NULL,",
      "remarks VARCHAR(600) NULL,counted_by INT NULL,counted_at DATETIME NULL,",
      "PRIMARY KEY (count_id,product_id),",
      "INDEX idx_blind_products (product_id)",
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    ].join(" "));
  })().catch(err=>{schemaPromise=null;throw err});
  return schemaPromise;
}
const storeId=req=>Number.isSafeInteger(Number(req.user?.branch_id))&&Number(req.user.branch_id)>0?Number(req.user.branch_id):null;
const idNum=s=>/^[1-9]\d{0,14}$/.test(String(s||""))?Number(s):null;
const text=(v,max)=>String(v||"").trim().slice(0,max);
const actor=req=>Number.isInteger(Number(req.user?.id))&&Number(req.user.id)>0?Number(req.user.id):null;
async function session(db,id,branch,lock=false){
 const [rows]=await db.query("SELECT c.*,b.code AS branch_code,b.name AS branch_name FROM spare_parts_blind_counts c INNER JOIN branches b ON b.id=c.branch_id WHERE c.id=? AND c.branch_id=? LIMIT 1"+(lock?" FOR UPDATE":""),[id,branch]);
 return rows[0]||null;
}
async function items(db,id){
 const [rows]=await db.query([
 "SELECT i.*,u.full_name AS counted_by_name",
 "FROM spare_parts_blind_count_items i LEFT JOIN users u ON u.id=i.counted_by",
 "WHERE i.count_id=? ORDER BY i.product_name,i.product_id"
 ].join(" "),[id]);return rows;
}
function view(item,reveal){
 const common={product_id:item.product_id,name:item.product_name,
   barcode:item.barcode||"",category:item.category||"",size:item.product_size||"",
   counted_qty:item.counted_qty,remarks:item.remarks||"",
   counted_at:item.counted_at||null,counted_by_name:item.counted_by_name||""};
 if(!reveal)return common;
 return {...common,expected_qty:Number(item.expected_qty),unit_cost:Number(item.unit_cost),
   unit_price:Number(item.unit_price),system_qty_at_submit:item.system_qty_at_submit};
}
router.use((req,res,next)=>{
 if(!storeId(req))return res.status(400).json({status:"error",code:"STORE_REQUIRED",message:"Select your authorised Spare Parts store."});
 if(!actor(req))return res.status(401).json({status:"error",message:"Sign in again before using stock counts."});
 next();
});
router.get("/",async(req,res)=>{
 try{
  await ready();const branch=storeId(req);
  const [records]=await pool.query([
    "SELECT c.id,c.title,c.status,c.created_at,c.submitted_at,c.reviewed_at,",
    "creator.full_name AS created_by_name,",
    "(SELECT COUNT(*) FROM spare_parts_blind_count_items i WHERE i.count_id=c.id) AS total_items,",
    "(SELECT COUNT(*) FROM spare_parts_blind_count_items i WHERE i.count_id=c.id AND i.counted_qty IS NOT NULL) AS completed_items",
    "FROM spare_parts_blind_counts c LEFT JOIN users creator ON creator.id=c.created_by",
    "WHERE c.branch_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT 100"
  ].join(" "),[branch]);
  return res.json({status:"success",sessions:records});
 }catch(e){console.error("Stock count list",e);return res.status(503).json({status:"error",message:"Could not load stock-count sessions."})}
});
router.post("/",async(req,res)=>{
 const title=text(req.body?.title,150);
 if(title.length<4)return res.status(400).json({status:"error",message:"Give this count a descriptive name (minimum four characters)."});
 let db;try{
  await ready();db=await pool.getConnection();await db.beginTransaction();
  const branch=storeId(req);
  const [stocks]=await db.query([
    "SELECT id,name,size,category,barcode,quantity,cost_price,selling_price",
    "FROM products WHERE branch_id=? AND is_active=TRUE ORDER BY id FOR UPDATE"
  ].join(" "),[branch]);
  if(!stocks.length){await db.rollback();return res.status(409).json({status:"error",message:"This store has no active products to count."})}
  if(stocks.length>15000){await db.rollback();return res.status(422).json({status:"error",message:"Too many products for one session. Contact the system administrator."})}
  const [created]=await db.query("INSERT INTO spare_parts_blind_counts (branch_id,title,created_by) VALUES (?,?,?)",[branch,title,actor(req)]);
  const countId=created.insertId;
  for(let offset=0;offset<stocks.length;offset+=300){
    const batch=stocks.slice(offset,offset+300);
    const marks=batch.map(()=>"(?,?,?,?,?,?,?,?,?)").join(",");
    const params=batch.flatMap(p=>[countId,p.id,String(p.name||""),p.size||"",p.category||"",p.barcode||"",Number(p.quantity||0),Number(p.cost_price||0),Number(p.selling_price||0)]);
    await db.query("INSERT INTO spare_parts_blind_count_items (count_id,product_id,product_name,product_size,category,barcode,expected_qty,unit_cost,unit_price) VALUES "+marks,params);
  }
  await db.commit();
  return res.status(201).json({status:"success",count_id:countId,product_count:stocks.length,message:"Blind count created. System quantities remain hidden until submission."});
 }catch(e){try{await db?.rollback()}catch{}console.error("Stock count create",e);return res.status(503).json({status:"error",message:"Could not create the count. No inventory was changed."})}
 finally{db?.release()}
});
router.get("/:id",async(req,res)=>{
 try{
  await ready();const id=idNum(req.params.id);if(!id)return res.status(400).json({status:"error",message:"Invalid stock-count ID."});
  const s=await session(pool,id,storeId(req));
  if(!s)return res.status(404).json({status:"error",message:"Stock count was not found in this store."});
  const all=await items(pool,id);
  const reveal=s.status!=="draft";
  const result={status:"success",session:{id:s.id,title:s.title,status:s.status,created_at:s.created_at,submitted_at:s.submitted_at,reviewed_at:s.reviewed_at,review_notes:s.review_notes},items:all.map(x=>view(x,reveal)),progress:{total:all.length,counted:all.filter(x=>x.counted_qty!==null).length}};
  if(reveal)result.analysis=analyzeLines(all);
  return res.json(result);
 }catch(e){console.error("Stock count read",e);return res.status(503).json({status:"error",message:"Could not open this stock count."})}
});
router.put("/:id/entries",async(req,res)=>{
 const id=idNum(req.params.id),list=req.body?.entries;
 if(!id||!Array.isArray(list)||!list.length||list.length>300)return res.status(400).json({status:"error",message:"Supply 1–300 valid product counts."});
 const seen=new Set();
 const valid=list.every(entry=>{
  const product=idNum(entry?.product_id);
  if(!product||seen.has(product))return false;
  seen.add(product);
  return (entry?.counted_qty===null||validInt(entry?.counted_qty)) &&
    String(entry?.remarks||"").length<=600;
 });
 if(!valid)return res.status(400).json({status:"error",message:"Count quantities must be non-negative whole numbers. Use an empty field for uncounted items, not zero."});
 let db;try{
  await ready();db=await pool.getConnection();await db.beginTransaction();
  const s=await session(db,id,storeId(req),true);
  if(!s){await db.rollback();return res.status(404).json({status:"error",message:"Stock count not found in this store."})}
  if(s.status!=="draft"){await db.rollback();return res.status(409).json({status:"error",message:"Submitted stock counts are immutable. Start a new count for revisions."})}
  for(const row of list){
    const [result]=await db.query("UPDATE spare_parts_blind_count_items SET counted_qty=?,remarks=?,counted_by=?,counted_at=NOW() WHERE count_id=? AND product_id=?",
      [row.counted_qty===null?null:Number(row.counted_qty),text(row.remarks,600)||null,actor(req),id,Number(row.product_id)]);
    if(result.affectedRows!==1)throw Object.assign(new Error("Unknown product or stale session."),{statusCode:409});
  }
  await db.commit();
  return res.json({status:"success",saved:list.length,message:"Count entries saved. System quantities are still hidden."});
 }catch(e){try{await db?.rollback()}catch{}console.error("Stock count entry save",e);return res.status(e.statusCode||503).json({status:"error",message:"Could not save all entries safely; none of this batch was applied."})}
 finally{db?.release()}
});
router.post("/:id/submit",async(req,res)=>{
 const id=idNum(req.params.id);if(!id)return res.status(400).json({status:"error",message:"Invalid count."});
 let db;try{
  await ready();db=await pool.getConnection();await db.beginTransaction();
  const s=await session(db,id,storeId(req),true);
  if(!s){await db.rollback();return res.status(404).json({status:"error",message:"Stock count not found."})}
  if(s.status!=="draft"){await db.rollback();return res.status(409).json({status:"error",message:"This count has already been submitted."})}
  const [missing]=await db.query("SELECT COUNT(*) AS n FROM spare_parts_blind_count_items WHERE count_id=? AND counted_qty IS NULL",[id]);
  if(Number(missing[0].n)>0){await db.rollback();return res.status(422).json({status:"error",message:missing[0].n+" products have not been counted. Enter the physical quantity, including zero where verified."})}
  const [updated]=await db.query([
    "UPDATE spare_parts_blind_count_items i",
    "LEFT JOIN products p ON p.id=i.product_id AND p.branch_id=?",
    "SET i.system_qty_at_submit=p.quantity",
    "WHERE i.count_id=?"
  ].join(" "),[storeId(req),id]);
  void updated;
  const [saved]=await db.query("UPDATE spare_parts_blind_counts SET status='submitted',submitted_by=?,submitted_at=NOW() WHERE id=? AND branch_id=? AND status='draft'",[actor(req),id,storeId(req)]);
  if(saved.affectedRows!==1)throw new Error("Concurrent submission detected.");
  await db.commit();
  return res.json({status:"success",message:"Blind count submitted and frozen. Differences are now available for investigation. No product stock was changed."});
 }catch(e){try{await db?.rollback()}catch{}console.error("Stock count submit",e);return res.status(503).json({status:"error",message:"Could not submit the count. Inventory was not changed."})}
 finally{db?.release()}
});
router.post("/:id/review",async(req,res)=>{
 if(!["admin","manager"].includes(String(req.user?.role||"").toLowerCase()))
   return res.status(403).json({status:"error",message:"A manager must independently review discrepancies."});
 const id=idNum(req.params.id),notes=text(req.body?.notes,2000);
 if(!id||notes.length<8)return res.status(400).json({status:"error",message:"Enter meaningful review notes (at least eight characters)."});
 let db;try{
  await ready();db=await pool.getConnection();await db.beginTransaction();
  const s=await session(db,id,storeId(req),true);
  if(!s){await db.rollback();return res.status(404).json({status:"error",message:"Count not found."})}
  if(s.status!=="submitted"){await db.rollback();return res.status(409).json({status:"error",message:"Only submitted counts can be reviewed."})}
  if(Number(s.created_by)===actor(req)||Number(s.submitted_by)===actor(req)){
    await db.rollback();return res.status(403).json({status:"error",message:"Independent approval is required. The count creator or submitter cannot review their own count."})
  }
  await db.query("UPDATE spare_parts_blind_counts SET status='reviewed',reviewed_by=?,reviewed_at=NOW(),review_notes=? WHERE id=? AND branch_id=? AND status='submitted'",[actor(req),notes,id,storeId(req)]);
  await db.commit();return res.json({status:"success",message:"Independent review saved. Inventory quantities remain unchanged."});
 }catch(e){try{await db?.rollback()}catch{}console.error("Stock count review",e);return res.status(503).json({status:"error",message:"Could not record independent review."})}
 finally{db?.release()}
});
router.get("/:id/export",async(req,res)=>{
 try{
  await ready();const id=idNum(req.params.id);
  if(!id)return res.status(400).json({status:"error",message:"Invalid count ID."});
  const s=await session(pool,id,storeId(req));
  if(!s)return res.status(404).json({status:"error",message:"Stock count not found in your store."});
  if(s.status==="draft")return res.status(409).json({status:"error",message:"Submit the blind count before downloading variance details."});
  const all=await items(pool,id);
  return await exportCount(res,s,all,req.query.format,req.user?.full_name||req.user?.username);
 }catch(e){console.error("Stock count export",e);if(res.headersSent)return;return res.status(503).json({status:"error",message:"Could not prepare the variance export."})}
});
module.exports=router;
