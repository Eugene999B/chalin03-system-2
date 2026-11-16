#!/usr/bin/env python3
"""Import licensed public-site photography at build time, never at page-view time.

This one-time asset preparation script downloads the *previously used* Unsplash
photo IDs and writes small, optimized files into the Cloudflare Pages public
directory. Fail rather than publishing missing/unverified placeholder images.
No site visitor should depend on Unsplash availability.
"""
from __future__ import annotations
import io
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from PIL import Image, ImageOps, UnidentifiedImageError

OUT = Path(__file__).resolve().parents[1] / "public/images/home/v1"
IMAGES = {
    "hero": "1747004066130-c6531b74d353",
    "excavators": "1751054619908-65d27a503ce8",
    "parts": "1766650189458-bb0e7969ba5d",
    "hire": "1719410491473-d06e21e25449",
}
SIZES = {
    "hero": [("hero-desktop.webp", 1600, 980, 78),
             ("hero-mobile.webp", 760, 1000, 76)],
    "excavators": [("excavators.webp", 960, 720, 75)],
    "parts": [("parts.webp", 960, 720, 75)],
    "hire": [("hire.webp", 960, 720, 75)],
}
LIMIT = 8_000_000

def fetch_photo(photo_id: str) -> Image.Image:
    url = f"https://images.unsplash.com/photo-{photo_id}?fit=crop&w=1800&q=85"
    for attempt in range(1, 5):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; CHALIN03-Photo-Importer/1.0)",
                "Accept": "image/avif,image/webp,image/*,*/*;q=0.7",
            })
            with urllib.request.urlopen(req, timeout=35) as r:
                if r.status != 200 or not r.headers.get("Content-Type", "").startswith("image/"):
                    raise ValueError(f"Non-image response for {photo_id}: HTTP {r.status}")
                data = r.read(LIMIT + 1)
                if len(data) > LIMIT:
                    raise ValueError(f"Photo {photo_id} unexpectedly large")
            image = Image.open(io.BytesIO(data))
            image.load()
            image = ImageOps.exif_transpose(image)
            if image.width < 700 or image.height < 500:
                raise ValueError(f"Photo {photo_id} too small: {image.size}")
            print("Fetched real photo", photo_id, image.size, "bytes", len(data))
            return image.convert("RGB")
        except (urllib.error.URLError, TimeoutError, ValueError, UnidentifiedImageError) as exc:
            print("Attempt", attempt, "failed for", photo_id, type(exc).__name__, str(exc)[:180], flush=True)
            if attempt == 4:
                raise
            time.sleep(attempt * 2)
    raise RuntimeError("unreachable")

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, photo_id in IMAGES.items():
        image = fetch_photo(photo_id)
        for filename, width, height, quality in SIZES[name]:
            # Cover crop matches the site's image slots, saving download bytes.
            fitted = ImageOps.fit(image, (width, height), method=Image.Resampling.LANCZOS,
                                  centering=(.57, .5) if name == "hero" else (.5, .5))
            path = OUT / filename
            fitted.save(path, format="WEBP", quality=quality, method=6)
            assert path.stat().st_size < 600_000, (
                f"Webp image unexpectedly large: {path.name}: {path.stat().st_size}"
            )
            with Image.open(path) as check:
                check.verify()
            print("Created", path, "bytes", path.stat().st_size, flush=True)

if __name__ == "__main__":
    main()
