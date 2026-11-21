# CHALIN03 public homepage image sources

This launch design uses **real Unsplash photography**, not AI-generated illustrations. These photos are illustrative editorial/marketing images **and are not photographs of CHALIN03-owned machines, parts, branches, or workers**. The public footer makes that distinction clear.

Photos are available under the [Unsplash License](https://unsplash.com/license) for commercial use. Photographers and original pages:

- **Hero:** Siwawut Phoophinyo — https://unsplash.com/photos/heres-a-caption-for-the-image-an-excavator-is-ready-for-work-on-a-construction-site-Jrjhyhpo9Rw (CDN photo ID `1747004066130-c6531b74d353`)
- **Excavators:** John Kakuk — https://unsplash.com/photos/an-excavator-works-on-an-earthy-construction-site-UQYuZLtrEwk (CDN photo ID `1751054619908-65d27a503ce8`)
- **Spare parts:** zai Dan — https://unsplash.com/photos/two-people-working-in-a-cluttered-workshop-with-spare-parts-isjTPQCOIMU (CDN photo ID `1766650189458-bb0e7969ba5d`)
- **Hiring:** Team Kiesel — https://unsplash.com/photos/an-orange-excavator-digging-dirt-in-a-construction-site-ii_AZ4yJuxU (CDN photo ID `1719410491473-d06e21e25449`)

### Operating rules

- Do **not** put model names, specific prices, quantities, or "in stock" badges on this public site without verified inventory data and sales approval.
- CHALIN03's actual machinery, warehouse and team photos should replace illustrative images when approved, with permission to publish.
- The same licensed photographs have been optimized into **five local WebP files** in `frontend/public/images/home/v1/`. Cloudflare Pages serves them from `chalin03.com` with long-lived versioned caching. The runtime homepage never requests Unsplash and its Content Security Policy no longer allows that image host.
- The hero uses a smaller, separately cropped mobile file; supporting photos load lazily and never cause extra downloads on the staff login screen.
- Image importer: `frontend/scripts/cache_public_homepage_photos.py` can recreate the static assets during a reviewed maintenance change. It is not executed at runtime.
- The phone number `+233 24 946 9080` and location "Dunkwa Police Barrier, Ghana" are carried from the previous public CHALIN03 website. Verify that this phone is also active on WhatsApp before public promotion.
- The service buttons lead to enquiries, **not** unbuilt shops or fake product listings. Staff Login still points to `/login`, and internal Mining/Hiring operations are untouched.
