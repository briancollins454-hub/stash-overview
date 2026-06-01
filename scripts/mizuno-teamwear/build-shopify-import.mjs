#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const inputPath = args[0];
const outDir = args[1] || path.resolve(process.cwd(), "scripts/mizuno-teamwear/out");

if (!inputPath) {
  console.error("Usage: node scripts/mizuno-teamwear/build-shopify-import.mjs <scrape.json> [out-dir]");
  process.exit(1);
}

const raw = fs.readFileSync(path.resolve(process.cwd(), inputPath), "utf8");
const payload = JSON.parse(raw);
const rows = Array.isArray(payload.products) ? payload.products : [];
const tableRows = Array.isArray(payload.rows) ? payload.rows : [];
const dataRows = Array.isArray(payload.data) ? payload.data : [];

fs.mkdirSync(outDir, { recursive: true });

const sanitizeTitleCase = (s) =>
  String(s || "")
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part) => {
      if (/^\s+$|-$/.test(part)) return part;
      return part ? part[0].toUpperCase() + part.slice(1) : part;
    })
    .join("")
    .trim();

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeSize = (size) =>
  String(size || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\//g, "-");

const isLikelyJunkTitle = (title) => {
  const t = String(title || "").toLowerCase();
  if (!t) return true;
  return [
    "chkhcd",
    "display your price",
    "function ",
    "#demo-nav",
    "home",
    "policies",
    "contact",
    "{",
    "}",
  ].some((needle) => t.includes(needle));
};

const isJuniorSize = (size) => {
  const s = normalizeSize(size);
  if (/^(116|128|140|152|164)$/.test(s)) return true;
  if (/^Y\d{1,2}$/.test(s)) return true;
  if (/^Y(XXS|XS|S|M|L|XL|XXL)?$/.test(s)) return true;
  if (/^J(XXS|XS|S|M|L|XL|XXL)?$/.test(s)) return true;
  if (/^JUNIOR/.test(s)) return true;
  return false;
};

const juniorNumericToY = {
  "116": "Y6",
  "128": "Y8",
  "140": "Y10",
  "152": "Y12",
  "164": "Y14",
};

const normalizeDisplaySize = (size, isJunior) => {
  const s = normalizeSize(size);
  if (isJunior && juniorNumericToY[s]) return juniorNumericToY[s];
  return s;
};
const ADULT_SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL", "7XL"];
const JUNIOR_SIZE_ORDER = ["Y4", "Y5", "Y6", "Y7", "Y8", "Y9", "Y10", "Y11", "Y12", "Y13", "Y14", "Y15", "Y16"];
const sizeOrderIndex = (size, isJunior) => {
  const s = normalizeSize(size);
  const arr = isJunior ? JUNIOR_SIZE_ORDER : ADULT_SIZE_ORDER;
  const idx = arr.indexOf(s);
  if (idx >= 0) return idx;
  const numericY = s.match(/^Y(\d{1,2})$/);
  if (numericY) return Number.parseInt(numericY[1], 10);
  return Number.MAX_SAFE_INTEGER;
};

const csvEscape = (value) => {
  const str = value == null ? "" : String(value);
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const toCsv = (headers, dataRows) => {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of dataRows) {
    lines.push(headers.map((h) => csvEscape(row[h] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
};

const grouped = new Map();
const styleBasePriceMap = new Map();
const SELL_MARKUP_MULTIPLIER = 2;
const JUNIOR_FALLBACK_COST_FACTOR = 0.8;
const canonicalFamily = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/\b(mizuno)\b/g, "")
    .replace(/\b(jr|junior|youth|kids)\b/g, "")
    .replace(/\((m|w|c|u)\)/g, "")
    .replace(/\b(jk|jkt)\b/g, "jacket")
    .replace(/\bg\b/g, "gym")
    .replace(/\b(ter)\b/g, "terry")
    .replace(/\b(auth)\b/g, "authentic")
    .replace(/\b(wom)\b/g, "women")
    .replace(/\b(men|mens|women|womens|unisex)\b/g, "")
    .replace(/\b[a-z0-9]{8}[a-z]?\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const upsertGrouped = (p) => {
  const style = (p.styleCode || "").toUpperCase();
  const colorCode = (p.colorCode || "").toUpperCase();
  const colorName = sanitizeTitleCase(p.colorName || "");
  const baseName = sanitizeTitleCase(p.title || "").replace(/\s+/g, " ");
  if (!style || (!colorCode && !colorName) || !baseName) return;

  const familyKey = canonicalFamily(baseName) || baseName.toLowerCase();
  const key = `${familyKey}::${colorCode || colorName}`;
  if (!grouped.has(key)) {
    grouped.set(key, {
      styleCode: style,
      styleCodes: new Set([style]),
      colorCode,
      colorName,
      baseName,
      familyKey,
      juniorHint: /\b(jr|junior|\(c\)|youth|kids)\b/i.test(baseName),
      description: p.description || "",
      listedPrice: Number.isFinite(p.listedPrice) ? p.listedPrice : null,
      imageUrls: new Set(),
      juniorSizes: new Set(),
      adultSizes: new Set(),
      unknownSizes: new Set(),
      variants: new Set(),
      sourceUrls: new Set(),
    });
  }
  const entry = grouped.get(key);
  entry.styleCodes.add(style);
  if (/\b(jr|junior|\(c\)|youth|kids)\b/i.test(baseName)) entry.juniorHint = true;
  if (entry.baseName.includes("Jr") && !baseName.includes("Jr")) entry.baseName = baseName;
  if (!entry.description && p.description) entry.description = p.description;
  if (!entry.listedPrice && Number.isFinite(p.listedPrice)) entry.listedPrice = p.listedPrice;
  (p.imageUrls || []).forEach((u) => entry.imageUrls.add(u));
  (p.sizes?.junior || []).forEach((s) => {
    entry.juniorSizes.add(s);
    entry.variants.add(JSON.stringify({ style, size: s, junior: true }));
  });
  (p.sizes?.adult || []).forEach((s) => {
    entry.adultSizes.add(s);
    entry.variants.add(JSON.stringify({ style, size: s, junior: false }));
  });
  (p.sizes?.unknown || []).forEach((s) => {
    entry.unknownSizes.add(s);
    entry.variants.add(JSON.stringify({ style, size: s, junior: null }));
  });
  if (p.sourceUrl) entry.sourceUrls.add(p.sourceUrl);
};

for (const p of rows) {
  upsertGrouped(p);
}

// Parser for detail-grid/card exports with payload.data
if (!grouped.size && dataRows.length) {
  for (const r of dataRows) {
    const rowBasePrice = Number.isFinite(r.basePrice) ? Number(r.basePrice) : null;
    const rowStyleCode = String(r.styleCode || "").toUpperCase();
    if (rowStyleCode && rowBasePrice != null && !styleBasePriceMap.has(rowStyleCode)) {
      styleBasePriceMap.set(rowStyleCode, rowBasePrice);
    }

    const parsed = {
      sourceUrl: r.sourcePage || payload.sourcePage || "",
      title: r.styleName || "",
      description: r.description || "",
      styleCode: rowStyleCode,
      colorCode: String(r.colorCode || "").toUpperCase(),
      colorName: r.colorName || "",
      listedPrice: rowBasePrice,
      imageUrls: r.imageUrl ? [r.imageUrl] : [],
      sizes: {
        junior: [],
        adult: Array.isArray(r.sizes) ? r.sizes : [],
        unknown: [],
      },
    };
    upsertGrouped(parsed);

    const key = `${canonicalFamily(parsed.title) || parsed.title.toLowerCase()}::${parsed.colorCode || sanitizeTitleCase(parsed.colorName || "")}`;
    const entry = grouped.get(key);
    if (entry && Array.isArray(r.sizes) && Array.isArray(r.availability)) {
      entry.inventoryBySize = entry.inventoryBySize || {};
      r.sizes.forEach((size, idx) => {
        const qtyText = String(r.availability[idx] ?? "").trim();
        const qty = qtyText === "20+" ? 20 : Number.parseInt(qtyText, 10);
        if (Number.isFinite(qty)) entry.inventoryBySize[String(size).toUpperCase()] = qty;
      });
    }
  }
}

// Backfill missing color-level prices from style-level base prices.
for (const [, item] of grouped) {
  if (item.listedPrice == null && styleBasePriceMap.has(item.styleCode)) {
    item.listedPrice = styleBasePriceMap.get(item.styleCode);
  }
}

// Merge junior and adult products with same color and similar family names.
const tokenize = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !["mizuno", "teamwear", "men", "women", "womens", "mens", "junior", "jr"].includes(t));

const tokenOverlap = (a, b) => {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  A.forEach((t) => {
    if (B.has(t)) common += 1;
  });
  return common / Math.min(A.size, B.size);
};

const keys = [...grouped.keys()];
const consumed = new Set();
for (let i = 0; i < keys.length; i += 1) {
  const k1 = keys[i];
  if (consumed.has(k1)) continue;
  const a = grouped.get(k1);
  if (!a) continue;

  for (let j = i + 1; j < keys.length; j += 1) {
    const k2 = keys[j];
    if (consumed.has(k2)) continue;
    const b = grouped.get(k2);
    if (!b) continue;

    const sameColor = (a.colorCode || a.colorName) && (a.colorCode || a.colorName) === (b.colorCode || b.colorName);
    if (!sameColor) continue;
    if (!(a.juniorHint || b.juniorHint)) continue;
    const overlap = tokenOverlap(a.familyKey || a.baseName, b.familyKey || b.baseName);
    if (overlap < 0.55) continue;

    const target = a.juniorHint && !b.juniorHint ? b : a;
    const source = target === a ? b : a;

    source.styleCodes.forEach((s) => target.styleCodes.add(s));
    source.imageUrls.forEach((u) => target.imageUrls.add(u));
    source.juniorSizes.forEach((s) => target.juniorSizes.add(s));
    source.adultSizes.forEach((s) => target.adultSizes.add(s));
    source.unknownSizes.forEach((s) => target.unknownSizes.add(s));
    source.variants.forEach((v) => target.variants.add(v));
    source.sourceUrls.forEach((u) => target.sourceUrls.add(u));
    if (!target.description && source.description) target.description = source.description;
    if (target.listedPrice == null && source.listedPrice != null) target.listedPrice = source.listedPrice;
    grouped.delete(target === a ? k2 : k1);
    consumed.add(target === a ? k2 : k1);
  }
}

// Fallback parser for row-based extracts (mizuno-rows-*.json)
if (!grouped.size && tableRows.length) {
  const styleHeader = tableRows.find((r) => /MIZUNO.+\([A-Z]\)/i.test(r.text || ""));
  const styleHeaderText = styleHeader?.text || "";
  const styleCodeMatch = (styleHeader?.html || "").match(/\b([A-Z0-9]{8})\.(\d{2})\b/);
  const styleCode = styleCodeMatch ? styleCodeMatch[1].toUpperCase() : "";

  const sizeCandidates = styleHeaderText
    .split(/\s+/)
    .filter((t) => /^(XXS|XS|S|M|L|XL|XXL|3XL|4XL|5XL|6XL|7XL|8|10|12|14|16)$/i.test(t))
    .map((t) => t.toUpperCase());
  const allSizes = sizeCandidates.length ? sizeCandidates : ["XS", "S", "M", "L", "XL"];

  const detailRows = tableRows.filter((r) => /\/A\d{2}\s+\d{2}/i.test(r.text || ""));
  for (const d of detailRows) {
    const colorNameMatch = (d.text || "").match(/^([A-Za-z\s]+)\/A\d{2}/);
    const colorCodeMatch = (d.text || "").match(/\/(A\d{2})\s+(\d{2})/);
    const hiddenStyleMatch = (d.html || "").match(/\b([A-Z0-9]{8})\.(\d{2})\b/);
    const image = d.images?.[0] || "";

    const availMatches = [...((d.text || "").matchAll(/\b(20\+|\d{1,3})\b/g) || [])].map((m) => m[1]);
    const availability = availMatches.slice(-allSizes.length);

    const parsed = {
      sourceUrl: payload.sourcePage || "",
      title: sanitizeTitleCase((styleHeaderText.split(" XXS")[0] || styleHeaderText).trim()),
      description: "",
      styleCode: (hiddenStyleMatch?.[1] || styleCode || "").toUpperCase(),
      colorCode: (colorCodeMatch?.[2] || "").toUpperCase(),
      colorName: sanitizeTitleCase((colorNameMatch?.[1] || "").trim()),
      listedPrice: null,
      imageUrls: image ? [image] : [],
      sizes: {
        junior: [],
        adult: allSizes,
        unknown: [],
      },
    };
    upsertGrouped(parsed);

    // attach provisional inventory by size for this color
    const key = `${canonicalFamily(parsed.title) || parsed.title.toLowerCase()}::${parsed.colorCode || parsed.colorName}`;
    const entry = grouped.get(key);
    if (entry && availability.length) {
      entry.inventoryBySize = entry.inventoryBySize || {};
      allSizes.forEach((size, idx) => {
        const qtyText = availability[idx] || "";
        const qty = qtyText === "20+" ? 20 : Number.parseInt(qtyText, 10);
        if (Number.isFinite(qty)) entry.inventoryBySize[size] = qty;
      });
    }
  }
}

const shopifyHeaders = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Product Category",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Variant SKU",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Inventory Tracker",
  "Variant Inventory Qty",
  "Variant Inventory Policy",
  "Variant Fulfillment Service",
  "Variant Taxable",
  "Status",
  "Image Src",
  "Image Position",
  "Cost per item",
];

const inventoryHeaders = ["sku", "available", "note"];
const qaHeaders = [
  "title",
  "styleCode",
  "colorCode",
  "colorName",
  "sizeCount",
  "missingPrice",
  "missingDescription",
  "missingImages",
  "sourceUrlCount",
];

const shopifyRows = [];
const strictShopifyRows = [];
const inventoryRows = [];
const qaRows = [];
let filteredOutProducts = 0;

for (const [, item] of grouped) {
  if (isLikelyJunkTitle(item.baseName)) {
    filteredOutProducts += 1;
    continue;
  }

  const color = item.colorName || item.colorCode || "Unknown";
  const productTitle = `Mizuno - ${item.baseName} - ${color}`;
  const handle = slugify(productTitle);

  let allSizes = [...item.variants].map((v) => JSON.parse(v));
  if (!allSizes.length) {
    allSizes = [
      ...[...item.juniorSizes].map((s) => ({ style: item.styleCode, size: s, junior: true })),
      ...[...item.adultSizes].map((s) => ({ style: item.styleCode, size: s, junior: false })),
      ...[...item.unknownSizes].map((s) => ({ style: item.styleCode, size: s, junior: null })),
    ];
  }

  const primaryImage = [...item.imageUrls][0] || "";
  const tagsBase = [
    "mizuno-teamwear",
    `style-${[...item.styleCodes][0].toLowerCase()}`,
    item.colorCode ? `colour-${item.colorCode.toLowerCase()}` : "",
    item.colorName ? `color-${slugify(item.colorName)}` : "",
  ].filter(Boolean);

  if (!allSizes.length) {
    allSizes.push({ size: "ONE-SIZE", junior: null });
  }
  allSizes.sort((a, b) => {
    const aRaw = normalizeSize(a.size || "ONE-SIZE");
    const bRaw = normalizeSize(b.size || "ONE-SIZE");
    const aIsJunior = a.junior === true || isJuniorSize(aRaw);
    const bIsJunior = b.junior === true || isJuniorSize(bRaw);
    if (aIsJunior !== bIsJunior) return aIsJunior ? -1 : 1;
    const byDefinedOrder = sizeOrderIndex(aRaw, aIsJunior) - sizeOrderIndex(bRaw, bIsJunior);
    if (byDefinedOrder !== 0) return byDefinedOrder;
    return aRaw.localeCompare(bRaw);
  });
  const seenOptionValues = new Set();

  allSizes.forEach((entry, idx) => {
    const rawSize = normalizeSize(entry.size || "ONE-SIZE");
    const inferredJuniorByTitle = /\b(jr|junior|\(c\)|kids|youth)\b/i.test(item.baseName);
    const isJunior = entry.junior === true || isJuniorSize(rawSize) || inferredJuniorByTitle;
    const cleanSize = normalizeDisplaySize(rawSize, isJunior);
    if (seenOptionValues.has(cleanSize)) return;
    seenOptionValues.add(cleanSize);
    const variantStyle = String(entry.style || item.styleCode || "").toUpperCase();
    const sku = `${variantStyle}-${item.colorCode || "NA"}-${cleanSize}`;
    const qty = item.inventoryBySize?.[rawSize] ?? item.inventoryBySize?.[cleanSize] ?? "";
    const tags = [...tagsBase, isJunior ? "vat-exempt-junior" : "vat-standard"].join(", ");
    const styleLevelCost = styleBasePriceMap.has(variantStyle) ? styleBasePriceMap.get(variantStyle) : null;
    const mergedLevelCost = item.listedPrice != null ? item.listedPrice : null;
    let variantCost = styleLevelCost ?? mergedLevelCost;
    if (isJunior && styleLevelCost == null && mergedLevelCost != null) {
      variantCost = mergedLevelCost * JUNIOR_FALLBACK_COST_FACTOR;
    }
    const roundedCost = variantCost != null ? Number(variantCost.toFixed(2)) : "";
    const variantSell =
      variantCost != null ? Number((variantCost * SELL_MARKUP_MULTIPLIER).toFixed(2)) : "";

    const csvRow = {
      Handle: handle,
      Title: idx === 0 ? productTitle : "",
      "Body (HTML)": idx === 0 ? item.description : "",
      Vendor: idx === 0 ? "Mizuno" : "",
      "Product Category": idx === 0 ? "Apparel & Accessories" : "",
      Type: idx === 0 ? "Teamwear" : "",
      Tags: idx === 0 ? tags : "",
      Published: "FALSE",
      "Option1 Name": "Size",
      "Option1 Value": cleanSize,
      "Variant SKU": sku,
      "Variant Price": variantSell,
      "Variant Compare At Price": "",
      "Variant Inventory Tracker": "shopify",
      "Variant Inventory Qty": qty,
      "Variant Inventory Policy": "deny",
      "Variant Fulfillment Service": "manual",
      "Variant Taxable": isJunior ? "FALSE" : "TRUE",
      Status: "draft",
      "Image Src": idx === 0 ? primaryImage : "",
      "Image Position": idx === 0 ? "1" : "",
      "Cost per item": roundedCost,
    };
    shopifyRows.push(csvRow);
    if (variantCost != null && primaryImage) {
      strictShopifyRows.push(csvRow);
    }

    inventoryRows.push({
      sku,
      available: item.inventoryBySize?.[cleanSize] ?? "",
      note: "Verify inventory if 20+ capped at 20.",
    });
  });

  qaRows.push({
    title: productTitle,
    styleCode: [...item.styleCodes].join("|"),
    colorCode: item.colorCode,
    colorName: item.colorName,
    sizeCount: allSizes.length,
    missingPrice: item.listedPrice == null ? "YES" : "NO",
    missingDescription: item.description ? "NO" : "YES",
    missingImages: item.imageUrls.size ? "NO" : "YES",
    sourceUrlCount: item.sourceUrls.size,
  });
}

const shopifyCsv = toCsv(shopifyHeaders, shopifyRows);
const strictShopifyCsv = toCsv(shopifyHeaders, strictShopifyRows);
const inventoryCsv = toCsv(inventoryHeaders, inventoryRows);
const qaCsv = toCsv(qaHeaders, qaRows);

fs.writeFileSync(path.join(outDir, "shopify-mizuno-teamwear.csv"), shopifyCsv, "utf8");
fs.writeFileSync(path.join(outDir, "shopify-mizuno-teamwear-strict.csv"), strictShopifyCsv, "utf8");
fs.writeFileSync(path.join(outDir, "syncio-inventory-template.csv"), inventoryCsv, "utf8");
fs.writeFileSync(path.join(outDir, "qa-mizuno-teamwear.csv"), qaCsv, "utf8");

const summary = {
  inputProducts: rows.length || dataRows.length || tableRows.length,
  groupedProducts: grouped.size,
  filteredOutProducts,
  shopifyRows: shopifyRows.length,
  strictShopifyRows: strictShopifyRows.length,
  inventoryRows: inventoryRows.length,
  outputDirectory: outDir,
};

fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
console.log("Generated files:", summary);
