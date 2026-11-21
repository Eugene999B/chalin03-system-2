"use strict";
const express=require("express");
const crypto=require("node:crypto");
const sharp=require("sharp");
const {uploadObject,config:storageConfig}=require("../services/objectStorageService");
const rateLimit=require("express-rate-limit");
const {pool}=require("../config/db");
const {requireAuth}=require("../middleware/authMiddleware");
const {writeAuditEvent}=require("../services/auditTrailService");
const {normalizeStoredImage}=require("../services/equipmentFinanceProtectedImageService");

const router=express.Router();
const MAIN_STORE=1; // Source workbook: MAIN - Chalin 03 Main Store, Store ID 1.
const ALLOWED_TYPES=new Set(["parts_order","equipment_enquiry","service_enquiry","message"]);
const ALLOWED_STATES=new Set(["contacted","quoted","cancelled"]);
const PHONE=/^\+?[0-9]{9,15}$/;
const LINK_DOMAINS=new Set(["images.unsplash.com","upload.wikimedia.org","images.pexels.com"]);
const SORTS=new Set(["featured","name","price_asc","price_desc"]);
const SOURCES=Object.freeze({
 filters:"/images/home/v1/parts.webp",
 tools:"/images/home/v1/parts.webp",
 oils:"/images/home/v1/parts.webp",
 engine:"/images/home/v1/parts.webp",
 hydraulic:"/images/home/v1/parts.webp",
 undercarriage:"/images/home/v1/parts.webp",
 electrical:"/images/home/v1/parts.webp",
 accessories:"/images/home/v1/parts.webp",
 motorcycles:"/images/home/v1/parts.webp",
 general:"/images/home/v1/parts.webp",
});
const limiter=rateLimit({
  windowMs:15*60*1000,limit:9,standardHeaders:"draft-7",legacyHeaders:false,
  message:{status:"error",code:"PUBLIC_REQUEST_RATE_LIMIT",
    message:"You have sent several enquiries. Please call us directly or try again later."},
});
function numberId(v){const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;}
function str(v,max=180){return String(v??"").trim().replace(/\s+/g," ").slice(0,max);}
function currency(v){const n=Number(v);return Number.isFinite(n)&&n>=0?Math.round(n*100)/100:0;}
function phone(v){const p=str(v,32).replace(/[()\s.-]/g,"");return PHONE.test(p)?p:null;}
function samePhone(a,b){const x=phone(a),y=phone(b);return Boolean(x&&y&&x.replace(/\D/g,"").slice(-9)===y.replace(/\D/g,"").slice(-9));}
function category(name,value){
 const v=(str(name,150)+" "+str(value,110)).toLowerCase();
 if(/motor ?bike|motorcycle|scooter/.test(v))return "Motorcycles & accessories";
 if(/engine|piston|liner|injector|turbo|cylinder|gasket/.test(v))return "Engines & components";
 if(/filter|air cleaner|separator/.test(v))return "Filters & servicing";
 if(/oil|lubricant|grease|coolant|hydraulic fluid|atf/.test(v))return "Oils, grease & fluids";
 if(/spanner|hammer|wrench|socket|screwdriver|pliers|tool|welding/.test(v))return "Tools & workshop";
 if(/hydraulic|hose|pump|valve|seal|o-ring|oring|pipe/.test(v))return "Hydraulics & seals";
 if(/track|idler|roller|teeth|tooth|sprocket|undercarriage|bush|pin|spacer/.test(v))return "Undercarriage & ground-engaging";
 if(/battery|alternator|starter|switch|light|wire|cable|charger|monitor/.test(v))return "Electrical & starting";
 if(/gear|belt|bearing|shaft|coupling|fan|radiator|tank/.test(v))return "Drivetrain & cooling";
 return "Other spare parts";
}
function safeImageUrl(v){
 const s=str(v,1000);
 if(/^\/images\/[A-Za-z0-9/_-]+\.(?:webp|png|jpg|jpeg)$/i.test(s))return s;
 try{
  const u=new URL(s);
  if(u.protocol==="https:"&&LINK_DOMAINS.has(u.hostname))return u.href;
 }catch{}
 return null;
}
function illustration(group){
 const key=/motorcycle/i.test(group)?"motorcycles":/filter/i.test(group)?"filters":
   /oil|grease/i.test(group)?"oils":/tool/i.test(group)?"tools":
   /hydraulic/i.test(group)?"hydraulic":/engine/i.test(group)?"engine":
   /undercarriage/i.test(group)?"undercarriage":"general";
 return SOURCES[key];
}
function eligible(req){
 const role=String(req.user?.role||"").toLowerCase();
 if(!["admin","manager","auditor","cashier","staff"].includes(role))return false;
 return Number(req.user?.branch_id||0)===MAIN_STORE||Number(req.user?.can_access_all_branches||0)===1||role==="admin";
}
function requireStaff(req,res,next){
 if(!eligible(req))return res.status(403).json({status:"error",message:"This is a protected Spare Parts online-order workspace."});
 next();
}
function requireManager(req,res,next){
 if(!eligible(req)||!["admin","manager"].includes(String(req.user?.role||"").toLowerCase()))
  return res.status(403).json({status:"error",message:"A Spare Parts manager must perform this action."});
 next();
}
function requireAdmin(req,res,next){
 if(!eligible(req)||String(req.user?.role||"").toLowerCase()!=="admin")
  return res.status(403).json({status:"error",message:"Only a System Administrator or Boss administrator can manage the public catalogue."});
 next();
}
async function auditAction(req,action,id,details){
 try{
  await writeAuditEvent({req,branchId:MAIN_STORE,userId:req.user?.id||null,
    action,details,workspaceCode:"spare_parts",entityType:"website_customer_request",
    entityId:id,actionType:action,outcome:"success",severity:"notice"});
 }catch(error){console.warn("Public commerce audit deferred:",error.code||"AUDIT_ERROR");}
}
function safeProduct(row){
 const group=str(row.category_override)||category(row.name,row.category);
 const hasStoredPhoto=Boolean(Number(row.has_catalog_photo)||Number(row.has_inventory_photo));
 return {
  id:Number(row.id),name:str(row.name,160),size:str(row.size,100),
  category:group,price:Number(row.selling_price)>0?currency(row.selling_price):null,
  image_url:hasStoredPhoto?"/api/public-commerce/products/"+row.id+"/photo":illustration(group),
  image_is_illustrative:!hasStoredPhoto,
  in_stock:Number(row.quantity)>0 && Number(row.selling_price)>0,
  featured:Boolean(Number(row.is_featured||0)),
 };
}
async function catalogueRows(connection=pool){
 const [rows]=await connection.query(
  `SELECT p.id,p.branch_id,p.name,p.size,p.category,p.selling_price,p.quantity,
       IF(p.image_url IS NOT NULL AND p.image_url <> '',1,0) AS has_inventory_photo,
       IF(c.image_url IS NOT NULL AND c.image_url <> '',1,0) AS has_catalog_photo,
       c.category_override,c.is_featured,c.description
    FROM products p
    LEFT JOIN website_catalog_controls c ON c.product_id=p.id AND c.branch_id=p.branch_id
    WHERE p.branch_id=? AND p.is_active=1 AND COALESCE(c.is_visible,1)=1
    ORDER BY p.name,p.id`,[MAIN_STORE]);
 return rows;
}
router.get("/products",async(req,res)=>{
 try{
  const search=str(req.query.search,100).toLowerCase();
  const group=str(req.query.category,100);
  const sort=SORTS.has(req.query.sort)?req.query.sort:"featured";
  const page=Math.min(1000,Math.max(1,Number.parseInt(req.query.page,10)||1));
  const limit=Math.min(60,Math.max(1,Number.parseInt(req.query.limit,10)||24));
  const data=(await catalogueRows()).map(safeProduct);
  const groups=Array.from(new Set(data.map(p=>p.category))).sort();
  let results=data.filter(p=>(!search||[p.name,p.size,p.category].some(v=>v.toLowerCase().includes(search)))&&(!group||p.category===group));
  results.sort((a,b)=>{
   if(sort==="price_asc")return a.price-b.price||a.name.localeCompare(b.name);
   if(sort==="price_desc")return b.price-a.price||a.name.localeCompare(b.name);
   if(sort==="featured")return Number(b.featured)-Number(a.featured)||Number(b.in_stock)-Number(a.in_stock)||a.name.localeCompare(b.name);
   return a.name.localeCompare(b.name);
  });
  res.setHeader("Cache-Control","public,max-age=30,stale-while-revalidate=60");
  return res.json({status:"success",source:"live_spare_parts_main_store",
    count:results.length,page,limit,pages:Math.ceil(results.length/limit),
    categories:groups,products:results.slice((page-1)*limit,page*limit),
    disclaimer:"Prices are live listed store prices. Availability and final tax are confirmed by staff before payment."});
 }catch(error){console.error("Public catalogue read failed:",error.code||error.message);
  return res.status(503).json({status:"error",message:"The store catalogue is temporarily unavailable."});}
});
router.get("/products/:id/photo",async(req,res)=>{
 try{
  const itemId=numberId(req.params.id);
  if(!itemId)return res.sendStatus(404);
  const [rows]=await pool.query(
   `SELECT COALESCE(NULLIF(c.image_url,''),p.image_url) AS image_url FROM products p
      LEFT JOIN website_catalog_controls c ON c.product_id=p.id AND c.branch_id=p.branch_id
     WHERE p.id=? AND p.branch_id=? AND p.is_active=1 AND COALESCE(c.is_visible,1)=1
     LIMIT 1`,[itemId,MAIN_STORE]);
  if(!rows.length||!rows[0].image_url)return res.sendStatus(404);
  const value=rows[0].image_url;
  if(safeImageUrl(value))return res.sendStatus(404);
  const image=await normalizeStoredImage(value);
  res.setHeader("Content-Type",image.mimeType);
  res.setHeader("Content-Length",image.buffer.length);
  res.setHeader("Cache-Control","public,max-age=90");
  res.setHeader("X-Content-Type-Options","nosniff");
  return res.status(200).send(image.buffer);
 }catch(error){return res.sendStatus(404);}
});
router.post("/requests",limiter,async(req,res)=>{
 const body=req.body||{};
 const type=str(body.request_type,40);
 const name=str(body.customer_name,150);
 const contact=phone(body.customer_phone);
 const location=str(body.customer_location,255);
 const email=str(body.customer_email,190);
 const subject=str(body.subject,180);
 const message=str(body.message,3500);
 const clientKey=str(body.client_key,64);
 const items=body.items;
 if(!ALLOWED_TYPES.has(type)||name.length<2||!contact||location.length<2||
   (email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||
   !/^[0-9a-f]{8}-[0-9a-f-]{27,48}$/i.test(clientKey)||
   (str(body.website,120))){
  return res.status(400).json({status:"error",message:"Enter your name, valid telephone, location and request details."});
 }
 if(type==="parts_order"&&(!Array.isArray(items)||!items.length||items.length>30))
  return res.status(400).json({status:"error",message:"Choose between 1 and 30 spare-part items."});
 if(type!=="parts_order"&&!subject&&!message)
  return res.status(400).json({status:"error",message:"Describe which machine, vehicle or service you need."});
 const selected=[];
 if(type==="parts_order"){
  const ids=new Set();
  for(const item of items){
   const productId=numberId(item?.product_id),qty=Number(item?.quantity);
   if(!productId||!Number.isSafeInteger(qty)||qty<1||qty>200||ids.has(productId))
    return res.status(400).json({status:"error",message:"Select valid unique products and quantities."});
   ids.add(productId);selected.push({productId,qty});
  }
 }
 const conn=await pool.getConnection();
 try{
  await conn.beginTransaction();
  const [replay]=await conn.query("SELECT id,reference_code,customer_phone FROM website_customer_requests WHERE client_key=? FOR UPDATE",[clientKey]);
  if(replay.length){
   await conn.rollback();
   if(!samePhone(replay[0].customer_phone,contact))
    return res.status(409).json({status:"error",message:"This request key was already used."});
   return res.status(200).json({status:"success",duplicate:true,reference:replay[0].reference_code});
  }
  let total=0;
  const savedItems=[];
  if(selected.length){
   for(const item of selected){
    const [rows]=await conn.query(
     `SELECT p.id,p.name,p.selling_price,p.quantity FROM products p
        LEFT JOIN website_catalog_controls c ON c.product_id=p.id AND c.branch_id=p.branch_id
       WHERE p.id=? AND p.branch_id=? AND p.is_active=1 AND COALESCE(c.is_visible,1)=1
       LIMIT 1 FOR UPDATE`,[item.productId,MAIN_STORE]);
    if(!rows.length||Number(rows[0].quantity)<item.qty){
     await conn.rollback();
     return res.status(409).json({status:"error",code:"WEB_STOCK_CHANGED",
       message:"One item is unavailable in the requested quantity. Refresh the catalogue or send an enquiry."});
    }
    if(Number(rows[0].selling_price)<=0){
      await conn.rollback();
      return res.status(409).json({status:"error",message:"This item needs an approved selling price before it can be ordered."});
    }
    const price=currency(rows[0].selling_price);
    total=Math.round((total+price*item.qty)*100)/100;
    savedItems.push({id:item.productId,qty:item.qty,name:str(rows[0].name,200),price});
   }
  }
  const reference="WEB-"+crypto.randomBytes(8).toString("hex").toUpperCase();
  const [r]=await conn.query(
    `INSERT INTO website_customer_requests
      (reference_code,client_key,request_type,customer_name,customer_phone,customer_location,
       customer_email,subject,message,branch_id,estimated_total)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [reference,clientKey,type,name,contact,location,email||null,subject||null,message||null,MAIN_STORE,total]);
  for(const item of savedItems){
   await conn.query(
    `INSERT INTO website_customer_request_items
      (request_id,product_id,product_name_snapshot,quantity,unit_price_snapshot)
     VALUES (?,?,?,?,?)`,[r.insertId,item.id,item.name,item.qty,item.price]);
  }
  await conn.commit();
  return res.status(201).json({status:"success",reference,request_type:type,
    message:"Request received. Our team will contact you to confirm availability and payment. No payment was collected."});
 }catch(error){
  await conn.rollback().catch(()=>{});
  if(error.code==="ER_DUP_ENTRY")return res.status(409).json({status:"error",message:"This request was already submitted; check your reference."});
  console.error("Public request create failed:",error.code||error.message);
  return res.status(503).json({status:"error",message:"We could not save your request. Please contact us by WhatsApp or telephone."});
 }finally{conn.release();}
});
router.get("/staff/requests",requireAuth,requireStaff,async(req,res)=>{
 try{
  const status=str(req.query.status,30);
  const search=str(req.query.search,100);
  const limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit,10)||60));
  const params=[MAIN_STORE];
  let where="r.branch_id=?";
  if(status&&["new","contacted","quoted","cancelled","fulfilled"].includes(status)){where+=" AND r.status=?";params.push(status);}
  if(search){where+=" AND (r.reference_code LIKE ? OR r.customer_name LIKE ? OR r.customer_phone LIKE ? OR r.subject LIKE ?)";
   const pattern="%"+search+"%";params.push(pattern,pattern,pattern,pattern);}
  const [rows]=await pool.query(
   `SELECT r.id,r.reference_code,r.request_type,r.status,r.customer_name,r.customer_phone,
    r.customer_location,r.customer_email,r.subject,r.message,r.estimated_total,
    r.linked_sale_id,r.payment_method,r.confirmed_at,r.created_at,r.updated_at
    FROM website_customer_requests r WHERE \${where}
    ORDER BY FIELD(r.status,'new','contacted','quoted','fulfilled','cancelled'),r.created_at DESC
    LIMIT ?`,[...params,limit]);
  const ids=rows.map(x=>x.id);
  let items=[];
  if(ids.length){
   const [list]=await pool.query(
    `SELECT request_id,product_id,product_name_snapshot,quantity,unit_price_snapshot
     FROM website_customer_request_items WHERE request_id IN (\${ids.map(()=>"?").join(",")})
     ORDER BY id`,ids);
   items=list;
  }
  const map=new Map(rows.map(row=>[Number(row.id),{...row,items:[]}]));
  for(const item of items)map.get(Number(item.request_id))?.items.push(item);
  return res.json({status:"success",requests:[...map.values()]});
 }catch(error){console.error("Website staff requests failed:",error.code||error.message);
  return res.status(503).json({status:"error",message:"Could not load customer requests."});}
});
router.get("/staff/products",requireAuth,requireAdmin,async(_req,res)=>{
 try{
  const [rows]=await pool.query(
    `SELECT p.id,p.name,p.size,p.category,p.selling_price,p.quantity,p.is_active,
     IF(p.image_url IS NOT NULL AND p.image_url <> '',1,0) AS has_inventory_photo,
     IF(c.image_url IS NOT NULL AND c.image_url <> '',1,0) AS has_catalog_photo,
     c.is_visible,c.is_featured,c.category_override,c.description
     FROM products p LEFT JOIN website_catalog_controls c
      ON c.product_id=p.id AND c.branch_id=p.branch_id
     WHERE p.branch_id=? ORDER BY p.name`,[MAIN_STORE]);
  return res.json({status:"success",products:rows.map(row=>({
   id:row.id,name:row.name,size:row.size,category:category(row.name,row.category),
   selling_price:currency(row.selling_price),quantity:Number(row.quantity),is_active:Boolean(row.is_active),
   is_visible:row.is_visible===null?true:Boolean(row.is_visible),is_featured:Boolean(row.is_featured),
   category_override:row.category_override||"",description:row.description||"",
   image_url:"",
   existing_image:Boolean(Number(row.has_catalog_photo)||Number(row.has_inventory_photo))
  }))});
 }catch(error){return res.status(503).json({status:"error",message:"Could not load online publishing controls."});}
});
router.patch("/staff/products/:id",requireAuth,requireAdmin,async(req,res)=>{
 const id=numberId(req.params.id),b=req.body||{};
 if(!id||typeof b.is_visible!=="boolean"||typeof b.is_featured!=="boolean")
  return res.status(400).json({status:"error",message:"Choose a valid product and display settings."});
 const imageUrl=str(b.image_url,1000),categoryOverride=str(b.category_override,100),
   description=str(b.description,600);
 if(imageUrl&&!safeImageUrl(imageUrl))
  return res.status(400).json({status:"error",message:"Use an HTTPS photo from an approved image host or a CHALIN03 image path."});
 try{
  const [found]=await pool.query("SELECT id FROM products WHERE id=? AND branch_id=? LIMIT 1",[id,MAIN_STORE]);
  if(!found.length)return res.status(404).json({status:"error",message:"Product not found in MAIN store."});
  await pool.query(
   `INSERT INTO website_catalog_controls
     (product_id,branch_id,is_visible,is_featured,category_override,description,image_url,updated_by)
    VALUES (?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE is_visible=VALUES(is_visible),is_featured=VALUES(is_featured),
    category_override=VALUES(category_override),description=VALUES(description),
    image_url=COALESCE(VALUES(image_url),image_url),updated_by=VALUES(updated_by)`,
   [id,MAIN_STORE,b.is_visible?1:0,b.is_featured?1:0,
     categoryOverride||null,description||null,imageUrl||null,req.user.id]);
  await auditAction(req,"WEBSITE_CATALOG_PUBLISHING_UPDATED",id,
   "Online product display updated; master selling price and stock were not modified.");
  return res.json({status:"success",message:"Online display saved. Inventory and price remained unchanged."});
 }catch(error){return res.status(503).json({status:"error",message:"Online display could not be saved."});}
});
// Product-specific photos must come from the actual item, not generic retailer images.
router.post("/staff/products/:id/photo",requireAuth,requireAdmin,async(req,res)=>{
 const id=numberId(req.params.id);
 const raw=String(req.body?.image_data_url||"").trim();
 const match=raw.length<=1300000?raw.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/):null;
 if(!id||!match)return res.status(400).json({status:"error",message:"Choose a JPEG, PNG or WebP item photo under 1 MB."});
 try{
  const [existing]=await pool.query("SELECT id FROM products WHERE id=? AND branch_id=? LIMIT 1",[id,MAIN_STORE]);
  if(!existing.length)return res.status(404).json({status:"error",message:"Main Store product not found."});
  const original=Buffer.from(match[2],"base64");
  if(original.length<100||original.length>900000)return res.status(400).json({status:"error",message:"Choose a valid product photo under 900 KB."});
  const converted=await sharp(original,{failOn:"error",limitInputPixels:30000000}).rotate()
   .resize(1000,1000,{fit:"inside",withoutEnlargement:true}).webp({quality:78,effort:4}).toBuffer();
  let stored="data:image/webp;base64,"+converted.toString("base64");
  if(storageConfig().enabled){
   const sha=crypto.createHash("sha256").update(converted).digest("hex");
   const key="chalin03/website/catalogue/"+id+"/"+sha+".webp";
   await uploadObject({key,buffer:converted,contentType:"image/webp"});
   stored="bucket://"+key;
  }
  await pool.query("INSERT INTO website_catalog_controls(product_id,branch_id,image_url,updated_by) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE image_url=VALUES(image_url),updated_by=VALUES(updated_by)",
   [id,MAIN_STORE,stored,req.user.id]);
  await auditAction(req,"WEBSITE_PRODUCT_IMAGE_UPDATED",id,"Product-specific photo updated; no stock or price change.");
  return res.json({status:"success",message:"Actual product photo uploaded.",photo_url:"/api/public-commerce/products/"+id+"/photo"});
 }catch(error){console.error("Online photo upload:",error.code||error.message);
  return res.status(503).json({status:"error",message:"Photo could not be saved; please choose another image."});}
});
router.patch("/staff/requests/:id/status",requireAuth,requireManager,async(req,res)=>{
 const id=numberId(req.params.id),status=str(req.body?.status,24);
 if(!id||!ALLOWED_STATES.has(status))
  return res.status(400).json({status:"error",message:"Choose Contacted, Quoted or Cancelled."});
 try{
  const [result]=await pool.query(
   `UPDATE website_customer_requests SET status=?,reviewed_by=?,reviewed_at=NOW()
     WHERE id=? AND branch_id=? AND linked_sale_id IS NULL AND status!='fulfilled'`,
   [status,req.user.id,id,MAIN_STORE]);
  if(!result.affectedRows)return res.status(409).json({status:"error",message:"This request is already fulfilled or no longer editable."});
  await auditAction(req,"WEBSITE_REQUEST_STATUS_CHANGED",id,"Online request marked "+status);
  return res.json({status:"success",message:"Customer follow-up updated."});
 }catch(error){return res.status(503).json({status:"error",message:"Request could not be updated."});}
});
// Fulfillment means LINKING an already completed, fully paid sale in the
// existing POS. POS is the ONLY workflow that deducts inventory and enters
// Daily Sales / Daily Closing. Never create a second stock mutation here.
router.post("/staff/requests/:id/fulfill",requireAuth,requireManager,async(req,res)=>{
 const requestId=numberId(req.params.id),saleId=numberId(req.body?.sale_id);
 const declared=str(req.body?.payment_method,12);
 if(!requestId||!saleId||!["cash","momo","bank"].includes(declared))
  return res.status(400).json({status:"error",message:"Enter a valid completed POS sale ID and actual payment method."});
 const c=await pool.getConnection();
 try{
  await c.beginTransaction();
  const [requestRows]=await c.query(
   "SELECT * FROM website_customer_requests WHERE id=? AND branch_id=? FOR UPDATE",
   [requestId,MAIN_STORE]);
  const request=requestRows[0];
  if(!request||request.request_type!=="parts_order"||request.status==="cancelled"){
   await c.rollback();
   return res.status(409).json({status:"error",message:"This is not an eligible spare-parts order."});
  }
  if(request.linked_sale_id){
   await c.rollback();
   return res.status(Number(request.linked_sale_id)===saleId?200:409)
    .json({status:Number(request.linked_sale_id)===saleId?"success":"error",
      message:"This order already has a recorded POS sale.",sale_id:request.linked_sale_id});
  }
  const [saleRows]=await c.query(
   `SELECT id,branch_id,customer_phone,total,amount_paid,balance,payment_type,sale_status,
          COALESCE(is_voided,0) AS is_voided
     FROM sales WHERE id=? AND branch_id=? LIMIT 1 FOR UPDATE`,[saleId,MAIN_STORE]);
  const sale=saleRows[0];
  if(!sale||sale.is_voided||sale.sale_status!=="completed"||
    Number(sale.balance)>0||Number(sale.amount_paid)+0.001<Number(sale.total)||
    sale.payment_type!==declared||!samePhone(sale.customer_phone,request.customer_phone)){
   await c.rollback();
   return res.status(409).json({status:"error",code:"WEB_POS_SALE_NOT_VERIFIED",
    message:"The POS sale is not a matching, fully paid, non-voided transaction for this customer and payment method."});
  }
  const [expected]=await c.query(
   "SELECT product_id,quantity FROM website_customer_request_items WHERE request_id=? ORDER BY product_id",
   [requestId]);
  const [actual]=await c.query(
   "SELECT product_id,SUM(quantity) AS quantity FROM sale_items WHERE sale_id=? GROUP BY product_id ORDER BY product_id",
   [saleId]);
  if(!expected.length||expected.length!==actual.length||
    expected.some((x,i)=>Number(x.product_id)!==Number(actual[i].product_id)||
      Number(x.quantity)!==Number(actual[i].quantity))){
   await c.rollback();
   return res.status(409).json({status:"error",code:"WEB_POS_ITEMS_MISMATCH",
    message:"The POS sale products or quantities do not exactly match this website order."});
  }
  await c.query(
   `UPDATE website_customer_requests
     SET status='fulfilled',linked_sale_id=?,payment_method=?,confirmed_by=?,confirmed_at=NOW()
     WHERE id=? AND branch_id=? AND linked_sale_id IS NULL`,
   [saleId,declared,req.user.id,requestId,MAIN_STORE]);
  await c.commit();
  await auditAction(req,"WEBSITE_ORDER_LINKED_TO_PAID_POS_SALE",requestId,
   "Online order linked to independently verified completed POS sale "+saleId);
  return res.json({status:"success",sale_id:saleId,
    message:"Order confirmed using the existing paid POS sale. Stock and Daily Sales were already updated by POS; no second deduction was made."});
 }catch(error){
  await c.rollback().catch(()=>{});
  if(error.code==="ER_DUP_ENTRY")return res.status(409).json({status:"error",message:"That POS sale is already linked to another online order."});
  console.error("Online order POS link failed:",error.code||error.message);
  return res.status(503).json({status:"error",message:"Could not verify the completed sale. No order was marked fulfilled."});
 }finally{c.release();}
});
module.exports={router,category,safeImageUrl,safeProduct,samePhone,MAIN_STORE};
