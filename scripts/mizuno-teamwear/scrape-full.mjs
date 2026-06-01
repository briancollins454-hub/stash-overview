#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const START_URL = "https://www.mizunodirect.com/e2wCustomerHome.aspx";
const OUT_DIR = path.resolve(process.cwd(), "scripts/mizuno-teamwear/out");
const PROFILE_DIR = path.resolve(process.cwd(), "scripts/mizuno-teamwear/.chrome-profile");

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

const parseGridRows = async (page) => {
  return page.$$eval("table.Grid", (tables) => {
    const cleanInner = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const rowsOut = [];

    tables.forEach((table) => {
      const headerCells = [...table.querySelectorAll("tr.GridHeader td")].map((td) => cleanInner(td.textContent));
      if (!headerCells.length) return;
      const styleName = headerCells[0] || "";
      const sizes = headerCells.slice(1).filter(Boolean);

      const rows = [...table.querySelectorAll("tr.GridRow")];
      rows.forEach((tr) => {
        const txt = cleanInner(tr.textContent);
        const html = tr.innerHTML;
        const match = html.match(/([A-Z0-9]{8}[A-Z]?)\.(\d{2})/);
        const styleCode = match ? match[1] : "";
        const colorCode = match ? match[2] : "";
        const colorMatch = txt.match(/^([A-Za-z\s]+)\/A\d{2}/);
        const colorName = colorMatch ? cleanInner(colorMatch[1]) : "";
        const img = tr.querySelector("img[src*='/img_catalog/']");
        const imageUrl = img ? new URL(img.getAttribute("src") || "", window.location.origin).href : "";
        const availability = [...tr.querySelectorAll("span[id*='lbl_Avail']")]
          .map((span) => cleanInner(span.textContent))
          .filter(Boolean);

        if (styleCode || colorCode || imageUrl) {
          rowsOut.push({
            styleName,
            styleCode,
            colorName,
            colorCode,
            sizes,
            availability,
            imageUrl,
          });
        }
      });
    });

    return rowsOut;
  });
};

const extractCatalogLinks = async (page) => {
  const absLinks = await page.$$eval("a[href*='e2wShoppingCatalog.aspx?parentId=']", (links) =>
    links
      .map((a) => {
        const href = a.getAttribute("href") || "";
        try {
          return new URL(href, window.location.origin).href;
        } catch {
          return "";
        }
      })
      .filter(Boolean)
  );
  return [...new Set(absLinks)];
};

const extractCardRows = async (page) => {
  return page.$$eval("img[src*='/img_catalog/']", (images) => {
    const cleanInner = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const rows = [];
    images.forEach((img) => {
      const src = img.getAttribute("src") || "";
      const imageUrl = new URL(src, window.location.origin).href;
      const styleFromImg = (src.match(/\/([A-Z0-9]{8}[A-Z]?)\.jpg/i) || [])[1] || "";

      let node = img;
      for (let i = 0; i < 8 && node?.parentElement; i += 1) {
        node = node.parentElement;
      }
      const text = cleanInner(node?.textContent || "");
      const styleName = text.split("|")[0]?.trim() || "";
      const basePrice = Number.parseFloat((text.match(/BASE PRICE[:\s]*([0-9]+(?:\.[0-9]{2})?)/i) || [])[1] || "");

      rows.push({
        styleName,
        styleCode: String(styleFromImg).toUpperCase(),
        colorName: "",
        colorCode: "",
        sizes: [],
        availability: [],
        imageUrl,
        basePrice: Number.isFinite(basePrice) ? basePrice : null,
      });
    });

    const dedup = [];
    const seen = new Set();
    rows.forEach((row) => {
      const key = `${row.styleCode}|${row.imageUrl}`;
      if (seen.has(key)) return;
      seen.add(key);
      dedup.push(row);
    });
    return dedup;
  });
};

const main = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1400, height: 900 },
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  const rl = readline.createInterface({ input, output });
  output.write("\nLog into Mizuno in the opened Chrome window.\n");
  await rl.question("When logged in and page loaded, press Enter to begin full scrape...");
  rl.close();

  const queue = await extractCatalogLinks(page);
  const visited = new Set();
  const discovered = new Set(queue);
  const records = [];
  const errors = [];

  while (queue.length) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(400);

      const gridRows = await parseGridRows(page);
      if (gridRows.length) {
        gridRows.forEach((row) => records.push({ ...row, sourcePage: url }));
      } else {
        const cardRows = await extractCardRows(page);
        cardRows.forEach((row) => records.push({ ...row, sourcePage: url }));
      }

      const links = await extractCatalogLinks(page);
      links.forEach((link) => {
        if (!discovered.has(link)) {
          discovered.add(link);
          queue.push(link);
        }
      });
    } catch (error) {
      errors.push({ url, error: String(error) });
    }
  }

  const dedup = [];
  const seen = new Set();
  records.forEach((row) => {
    const key = `${row.styleCode}|${row.colorCode}|${row.imageUrl}|${row.sourcePage}`;
    if (seen.has(key)) return;
    seen.add(key);
    dedup.push(row);
  });

  const payload = {
    scrapedAt: new Date().toISOString(),
    sourcePage: clean(await page.url()),
    categoriesVisited: visited.size,
    records: dedup.length,
    data: dedup,
    errors,
  };

  const outputPath = path.join(OUT_DIR, `mizuno-auto-full-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");

  output.write(`\nSaved scrape: ${outputPath}\n`);
  output.write("Next: node scripts/mizuno-teamwear/build-shopify-import.mjs \"<that-json-path>\"\n");
  await context.close();
};

main().catch((error) => {
  console.error("Scrape failed:", error);
  process.exit(1);
});
