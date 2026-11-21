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
 await expect(page.getByRole("heading",{level:1,name:/Equipment.*Enterprise.*Possibility/s})).toBeVisible();
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
 await expect(page.getByRole("heading",{level:1,name:/Equipment.*Enterprise.*Possibility/s})).toBeVisible();
 await expect(page.locator(".ce-division")).toHaveCount(7);
 const menu=page.getByRole("button",{name:"Open navigation"});await expect(menu).toBeVisible();
 await tapTarget(menu);await noHorizontalOverflow(page);
 await menu.click();
 await expect(page.getByRole("button",{name:"Close navigation"})).toHaveAttribute("aria-expanded","true");
 const parts=page.getByRole("navigation",{name:"Company navigation"}).getByRole("link",{name:"Spare-parts shop"});
 await tapTarget(parts);await parts.click();
 await expect(page).toHaveURL(/\/shop$/);
 await expect(page.getByRole("heading",{level:1,name:/Keep your machine moving/i})).toBeVisible();
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
