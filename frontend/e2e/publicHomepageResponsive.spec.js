import {test,expect} from "@playwright/test";
async function noHorizontalOverflow(page){
 const width=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
 expect(width.scroll-width.client).toBeLessThanOrEqual(2);
}
async function tapTarget(locator){
 const box=await locator.boundingBox();expect(box).not.toBeNull();
 expect(box.height).toBeGreaterThanOrEqual(44);
}
test("new CHALIN03 corporate website has independent seven-business photographic desktop experience",async({page},testInfo)=>{
 await page.setViewportSize({width:1440,height:900});
 await page.goto("/");
 await expect(page.getByRole("heading",{level:1,name:/CHALIN03.*Company Limited/s})).toBeVisible();
 await expect(page.getByRole("navigation",{name:"Company navigation"})).toBeVisible();
 await expect(page.locator(".ce-division")).toHaveCount(7);
 await expect(page.locator(".ce-market")).toBeVisible();
 await expect(page.locator(".ce-hero .real-photo img")).toHaveCount(1);
 await expect(page.locator(".ce-division__media .real-photo img")).toHaveCount(7);
 const parts=page.getByRole("navigation",{name:"Company navigation"}).getByRole("link",{name:"Spare-parts shop"});
 await expect(parts).toHaveAttribute("href","/shop");
 await expect(page.getByRole("link",{name:"Staff portal"}).first()).toHaveAttribute("href","/login");
 await noHorizontalOverflow(page);
 await page.screenshot({path:testInfo.outputPath("chalin03-reimagined-company-desktop.png"),fullPage:true});
});
test("new company mobile navigation opens dedicated Spare Parts Shop without layout overflow",async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto("/");
 await expect(page.getByRole("heading",{level:1,name:/CHALIN03.*Company Limited/s})).toBeVisible();
 await expect(page.locator(".ce-division")).toHaveCount(7);
 const menu=page.getByRole("button",{name:"Open navigation"});await expect(menu).toBeVisible();
 await tapTarget(menu);await noHorizontalOverflow(page);
 await menu.click();
 await expect(page.getByRole("button",{name:"Close navigation"})).toHaveAttribute("aria-expanded","true");
 const parts=page.getByRole("navigation",{name:"Company navigation"}).getByRole("link",{name:"Spare-parts shop"});
 await tapTarget(parts);await parts.click();
 await expect(page).toHaveURL(/\/shop$/);
 await expect(page.getByRole("heading",{level:1,name:/Spare parts & workshop supplies/i})).toBeVisible();
 await expect(page.locator(".pm-store-layout")).toBeVisible();
 await noHorizontalOverflow(page);
 await page.screenshot({path:testInfo.outputPath("chalin03-independent-market-mobile.png"),fullPage:true});
});
test("new company tablet layout retains readable real-photo business cards and featured market",async({page},testInfo)=>{
 await page.setViewportSize({width:768,height:1024});
 await page.goto("/");
 await expect(page.locator(".ce-market")).toBeVisible();
 await expect(page.locator(".ce-division")).toHaveCount(7);
 await expect(page.locator(".real-photo img").first()).toBeVisible();
 await noHorizontalOverflow(page);
 await page.screenshot({path:testInfo.outputPath("chalin03-company-tablet.png"),fullPage:true});
});
test("independent excavator model finder and secure quote are navigable",async({page})=>{
 await page.goto("/excavators");
 await expect(page.getByRole("heading",{level:1,name:/Excavators for your next big job/i})).toBeVisible();
 await expect(page.locator(".bd-item").first()).toBeVisible();
 await page.getByRole("searchbox",{name:/Search models and manufacturers/i}).fill("CAT 320");
 await expect(page.locator(".bd-item")).toHaveCount(1);
 await page.locator(".bd-item").getByRole("link",{name:/Enquire about CAT 320/i}).click();
 await expect(page).toHaveURL(/\/enquire\?/);
 await expect(page.getByRole("heading",{level:1,name:/Tell us what you need/i})).toBeVisible();
});

test("real excavator and parts photos load from the approved direct CDN, not redirect or cartoons",async({page})=>{
 test.setTimeout(50000);
 await page.setViewportSize({width:1400,height:900});
 await page.goto("/");
 const hero=page.locator(".ce-hero__photo img");
 await expect(hero).toHaveAttribute("src",/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\//);
 await expect.poll(async()=>hero.evaluate(el=>el.complete&&el.naturalWidth>=400),{timeout:20000,intervals:[500,1000,1500,2000]}).toBe(true);
 const parts=page.locator(".ce-market__primary img");
 await expect(parts).toHaveAttribute("src",/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\//);
 await expect.poll(async()=>parts.evaluate(el=>el.complete&&el.naturalWidth>=400),{timeout:20000,intervals:[500,1000,1500,2000]}).toBe(true);
 await expect(page.locator(".ce-hero__photo .real-photo__unavailable")).toHaveCount(0);
 await expect(page.locator(".ce-market__primary .real-photo__unavailable")).toHaveCount(0);
});


const TEST_PART={id:11,name:"Shell Oil 1L",size:"1L",category:"Oils & lubricants",
 price:75,in_stock:true,photo_status:"missing",image_url:null,featured:false};
const TEST_RESPONSE={status:"success",source:"live_spare_parts_main_store",
 count:1,page:1,limit:24,pages:1,categories:["Oils & lubricants"],products:[TEST_PART]};
function catalogueResponse(status){
 return {status,headers:{"access-control-allow-origin":"*","content-type":"application/json"},
  body:JSON.stringify(status===200?TEST_RESPONSE:{status:"error",message:"The store catalogue is temporarily unavailable."})};
}
test("spare parts market automatically recovers from a transient 503 and displays the product",async({page})=>{
 test.setTimeout(30000);
 let calls=0;
 await page.route("**/public-commerce/products**",async route=>{
  if(route.request().method()==="OPTIONS"){
   await route.fulfill({status:204,headers:{"access-control-allow-origin":"*","access-control-allow-methods":"GET, OPTIONS","access-control-allow-headers":"*"}});
   return;
  }
  calls+=1;
  await route.fulfill(catalogueResponse(calls===1?503:200));
 });
 await page.goto("/shop");
 await expect(page.getByText(/Temporary connection issue.*retrying the catalogue automatically/i)).toBeVisible();
 await expect(page.locator(".pm-product")).toHaveCount(1,{timeout:15000});
 await expect(page.getByRole("heading",{name:"Shell Oil 1L"})).toBeVisible();
 expect(calls).toBe(2);
 await expect(page.getByRole("button",{name:"Retry loading products"})).toHaveCount(0);
});
test("manual Retry loads products again when filters and page have not changed",async({page})=>{
 test.setTimeout(30000);
 let calls=0;
 await page.route("**/public-commerce/products**",async route=>{
  if(route.request().method()==="OPTIONS"){
   await route.fulfill({status:204,headers:{"access-control-allow-origin":"*","access-control-allow-methods":"GET, OPTIONS","access-control-allow-headers":"*"}});
   return;
  }
  calls+=1;
  await route.fulfill(catalogueResponse(calls<=2?503:200));
 });
 await page.goto("/shop");
 const retry=page.getByRole("button",{name:"Retry loading products"});
 await expect(retry).toBeVisible({timeout:15000});
 await retry.click();
 await expect(page.locator(".pm-product")).toHaveCount(1,{timeout:12000});
 expect(calls).toBe(3);
 await expect(retry).toHaveCount(0);
});
