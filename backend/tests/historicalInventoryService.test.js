"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {reportingPeriod,productRows}=require("../services/historicalInventoryService");
const date="2026-11-08",period=reportingPeriod(date,date,new Date("2026-11-26T12:00:00Z"));
const prod=(id,quantity,created_at="2026-10-01T00:00:00Z")=>({id,quantity,created_at,cost_price:10,selling_price:20});
const data=(extra={})=>({products:[prod(1,10)],movements:[],sales:[],items:[],returns:[],history:[],audit:[],costEvents:[],...extra});
test("same-day closing includes that day's sales but reverses subsequent sales, returns, purchases and transfers",()=>{
 const rows=productRows(data({products:[prod(1,10),prod(2,8,"2026-11-10T00:00:00Z")],movements:[{product_id:1,at:"2026-11-09T10:00:00Z",delta:5},{product_id:1,at:"2026-11-10T10:00:00Z",delta:-2}],sales:[{id:1,created_at:"2026-11-08T10:00:00Z"},{id:2,created_at:"2026-11-09T11:00:00Z"}],items:[{sale_id:1,product_id:1,quantity:2},{sale_id:2,product_id:1,quantity:4}],returns:[{sale_id:2,product_id:1,quantity:1,returned_at:"2026-11-10T12:00:00Z"}]}),period);
 assert.equal(rows.length,1);assert.equal(rows[0].quantity,10);assert.equal(rows[0].opening_quantity,12);assert.equal(rows[0].net_change,-2);
});
test("later edit uses original immutable product ID and quantity",()=>{
 const s={id:1,created_at:"2026-11-08T10:00:00Z",edited_at:"2026-11-12T10:00:00Z"};
 const rows=productRows(data({products:[prod(1,10),prod(2,7)],sales:[s],items:[{sale_id:1,product_id:2,quantity:3}],history:[{id:1,sale_id:1,created_at:s.edited_at,before_snapshot_json:{sale:{id:1,created_at:s.created_at},items:[{product_id:1,quantity:2}]}}]}),period);
 assert.deepEqual(rows.map(r=>r.quantity),[8,10]);
});
test("later void reverses only unreturned stock",()=>{
 const s={id:1,created_at:"2026-11-08T10:00:00Z",voided_at:"2026-11-12T10:00:00Z",is_voided:1};
 const rows=productRows(data({sales:[s],items:[{sale_id:1,product_id:1,quantity:4}],returns:[{sale_id:1,product_id:1,quantity:1,returned_at:"2026-11-08T12:00:00Z"}],history:[{id:1,sale_id:1,created_at:s.voided_at,before_snapshot_json:{sale:{id:1,created_at:s.created_at},items:[{product_id:1,quantity:4}]}}]}),period);
 assert.equal(rows[0].quantity,7);assert.equal(rows[0].opening_quantity,10);
});
test("invalid date and missing edit history fail instead of fabricating historical values",()=>{
 assert.throws(()=>reportingPeriod("2026-02-30",date));
 assert.throws(()=>productRows(data({sales:[{id:1,created_at:"2026-11-08T00:00:00Z",edited_at:"2026-11-12T00:00:00Z"}]}),period),/Missing sale change history/);
});
