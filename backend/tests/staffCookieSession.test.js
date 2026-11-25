"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const f=require("../services/staffCookieSession");
const jwt="aGVhZGVy.cGF5bG9hZA.c2lnbmF0dXJl";
const req={headers:{origin:"https://work.chalin03.com",host:"api.chalin03.com"}};
const response=()=>({cookies:[],headers:{},cookie(name,value,options){this.cookies.push({name,value,options});},set(k,v){this.headers[k]=v;},clearCookie(name,options){this.cleared={name,options};}});
test("pilot off leaves existing sign-in unchanged",()=>{const res=response();assert.equal(f.issueStaffSession(req,res,{token:jwt},{}).token,jwt);assert.equal(res.cookies.length,0);});
test("pilot issues HttpOnly host-only secure strict cookie and returns only a noncredential marker",()=>{
 const res=response(),data=f.issueStaffSession(req,res,{token:jwt,user:{id:42}},{STAFF_COOKIE_SESSIONS_ENABLED:"true"});
 assert.notEqual(data.token,jwt);assert.match(data.token,/^c03-cookie-v1\.[a-f0-9]{64}$/);assert.equal(JSON.stringify(data).includes(jwt),false);
 assert.deepEqual(res.cookies[0],{name:f.COOKIE,value:jwt,options:{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:28800000}});
 assert.equal(res.headers["Cache-Control"],"no-store");
});
test("marker requires exact cookie, trusted browser origin and API host",()=>{
 const marker=f.markerFor(jwt),cookie=f.COOKIE+"="+jwt;
 assert.deepEqual(f.resolveStaffBearer({headers:{...req.headers,cookie}},marker),{token:jwt,cookie:true});
 for(const headers of [{...req.headers},{...req.headers,cookie:cookie+"; "+cookie},{...req.headers,cookie:f.COOKIE+"=x.y.z"},{...req.headers,cookie,origin:"https://spareparts.chalin03.com"},{...req.headers,cookie,host:"example.com"},{...req.headers,cookie,origin:undefined}])assert.equal(f.resolveStaffBearer({headers},marker).token,null);
 assert.equal(f.resolveStaffBearer({headers:{...req.headers,cookie}},undefined).token,undefined);
 assert.equal(f.resolveStaffBearer(req,jwt).token,jwt);
});
test("only verified cookie logout clears the host cookie",()=>{const res=response();f.clearStaffSession(req,res);assert.equal(res.cleared,undefined);f.clearStaffSession({...req,staffCookieSession:true},res);assert.equal(res.cleared.name,f.COOKIE);});

test("separate staff reporting origin uses an independent secure cookie",()=>{const portal={headers:{origin:"https://staff.chalin03.com",host:"api.chalin03.com"}},res=response();const data=f.issueStaffSession(portal,res,{token:jwt},{STAFF_COOKIE_SESSIONS_ENABLED:"true"});const name=res.cookies[0].name;assert.equal(name,"__Host-chalin03-reporting-session");assert.deepEqual(f.resolveStaffBearer({headers:{...portal.headers,cookie:name+"="+jwt}},data.token),{token:jwt,cookie:true});assert.equal(f.resolveStaffBearer({headers:{...portal.headers,cookie:f.COOKIE+"="+jwt}},data.token).token,null);assert.equal(f.resolveStaffBearer({headers:{...req.headers,cookie:name+"="+jwt}},data.token).token,null);f.clearStaffSession({...portal,staffCookieSession:true},res);assert.equal(res.cleared.name,name);});
