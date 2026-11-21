import {test,expect} from "@playwright/test";

const part={id:11,name:"Shell Oil 1L",size:"All",category:"Oils, grease & fluids",price:100,in_stock:true};
const exact={id:32,name:"Test pump",size:"T200",category:"Hydraulics & seals",price:759.25,in_stock:true,
 image_url:"/images/catalogue/11-480.webp",photo_status:"verified_exact",photo_credit:"Test fixture",photo_license:"Test fixture"};
const missing={id:20,name:"Oil Filter (LF3349)",size:"All",category:"Filters & servicing",price:100,in_stock:false,
 photo_status:"needs_review",image_url:"/images/catalogue/11-480.webp"};
const label="REAL REFERENCE PHOTO — EXACT STOCK ITEM TO CONFIRM";

for(const width of [1440,768,390]){
 test(`SKU photo disclosure and catalogue actions work at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route("**/api/public-commerce/products?**",async route=>{
   const params=new URL(route.request().url()).searchParams;
   const pageNumber=Number(params.get("page")||1);
   const query=(params.get("search")||"").toLowerCase();
   const matches=[part,exact,missing].filter(p=>p.name.toLowerCase().includes(query));
   const products=pageNumber===2?[]:matches;
   await route.fulfill({json:{products,count:matches.length,pages:query?1:2,categories:[part.category,exact.category,missing.category]}});
  });
  await page.goto("/shop");
  const reference=page.getByRole("article").filter({has:page.getByRole("heading",{name:part.name,exact:true})});
  const review=page.getByRole("article").filter({has:page.getByRole("heading",{name:missing.name,exact:true})});
  const approved=page.getByRole("article").filter({has:page.getByRole("heading",{name:exact.name,exact:true})});
  await expect(reference.getByText(label)).toBeVisible();
  await expect(review.getByText("Photo under review")).toBeVisible();
  await expect(review.locator("img")).toHaveCount(0);
  await expect(approved.getByText(label)).toHaveCount(0);
  await expect(approved.getByText("GHS 759.25")).toBeVisible();
  await expect(review.getByRole("link",{name:"Enquire"})).toHaveAttribute("href",/Product%20%2320/);
  await reference.getByRole("button",{name:/Enlarge photo/}).scrollIntoViewIfNeeded();
  await expect.poll(()=>reference.locator("img").evaluate(img=>img.naturalWidth)).toBeGreaterThan(200);
  await reference.getByRole("button",{name:/Enlarge photo/}).click();
  const dialog=page.getByRole("dialog");
  await expect(dialog.getByText(label)).toBeVisible();
  await expect(dialog.getByRole("link",{name:"CC BY 2.0"})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await approved.getByRole("button",{name:"Add to basket"}).click();
  await expect(page.getByRole("complementary",{name:"Spare-parts order basket"}).getByText(exact.name)).toBeVisible();
  await page.getByRole("button",{name:"Close order basket"}).click();
  await page.getByRole("button",{name:/Next/}).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await page.getByRole("searchbox",{name:"Search the spare-parts shop",exact:true}).fill("LF3349");
  await expect(review).toBeVisible();
  await expect(reference).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
 });
}

test("a broken catalogue image falls back without claiming a stock photo",async({page})=>{
 await page.route("**/api/public-commerce/products?**",route=>route.fulfill({json:{products:[part],count:1,pages:1}}));
 await page.route("**/images/catalogue/11-*.webp",route=>route.abort());
 await page.goto("/shop");
 const reference=page.getByRole("article").filter({has:page.getByRole("heading",{name:part.name,exact:true})});
 await reference.scrollIntoViewIfNeeded();
 await expect(reference.getByText("Photo temporarily unavailable")).toBeVisible();
 await expect(reference.getByRole("link",{name:"Enquire"})).toBeVisible();
});

test("catalogue retries a temporary error and Retry reloads unchanged filters",async({page})=>{
 let requests=0;
 await page.route("**/api/public-commerce/products?**",route=>{
  requests++;
  if(requests<=3)return route.fulfill({status:503,json:{message:"The store catalogue is temporarily unavailable."}});
  return route.fulfill({json:{products:[part],count:1,pages:1}});
 });
 await page.goto("/shop");
 const alert=page.locator(".pm-error");
 await expect(alert).toContainText("temporarily unavailable");
 expect(requests).toBe(2);
 await alert.getByRole("button",{name:"Retry"}).click();
 await expect(page.getByRole("heading",{name:part.name,exact:true})).toBeVisible();
 await expect(alert).toHaveCount(0);
 expect(requests).toBe(4);
});
