# Mizuno Teamwear Import Workflow

This workflow lets you scrape Mizuno B2B while logged in via Chrome, then generate Shopify import files with your rules.

## Rules implemented

- One Shopify product per style+color
- Junior and adult merged into one product (sizes as variants)
- Product title format: `Mizuno - [Official Product Name] - [Colour]`
- SKU format: `[StyleCode]-[ColourCode]-[Size]`
- Sell price = `B2B listed price * 2`
- Junior sizes marked VAT-free (`Variant Taxable = FALSE`)
- All products created as draft (`Status = draft`, `Published = FALSE`)

## Step 1: Scrape from Mizuno B2B (while logged in)

1. Open a Mizuno B2B product listing page in Chrome.
2. Open DevTools Console.
3. Paste and run the script from:
   - `scripts/mizuno-teamwear/scrape-mizuno-b2b.js`
4. Wait for completion.
5. A JSON file downloads automatically (example: `mizuno-b2b-scrape-*.json`).

## Step 2: Build Shopify CSVs

From repo root:

```bash
node scripts/mizuno-teamwear/build-shopify-import.mjs "/path/to/mizuno-b2b-scrape-123.json"
```

Optional custom output directory:

```bash
node scripts/mizuno-teamwear/build-shopify-import.mjs "/path/to/mizuno-b2b-scrape-123.json" "scripts/mizuno-teamwear/out-run-1"
```

## Output files

- `shopify-mizuno-teamwear.csv`  
  Import to Shopify Products (all draft).
- `syncio-inventory-template.csv`  
  SKU list for inventory sync mapping.
- `qa-mizuno-teamwear.csv`  
  Flags missing price/description/images.
- `summary.json`  
  Counts and output location.

## Important checks before Shopify import

- Verify style codes and color codes parsed correctly
- Verify title case for product names/colors
- Confirm junior size detection is correct for VAT-free logic
- Confirm image URLs are valid and meet quality requirements (square, white background, >=1500px)
- Spot-check 10 products before full import

## Notes

- Because Mizuno B2B has no direct CSV export, scraper accuracy depends on page structure.
- If some fields are missing, update selectors in `scrape-mizuno-b2b.js` and run again.
- If a product has no sizes detected, script assigns `ONE-SIZE` placeholder so it is visible in QA.
