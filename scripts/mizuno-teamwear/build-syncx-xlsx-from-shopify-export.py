#!/usr/bin/env python3
"""
Build a SyncX / Adidas-shaped stock XLSX for Mizuno by joining:

  1) Mizuno feed (SKU, qty, title, size, ManCode) — e.g. mizuno-syncx-like-adidas.csv
  2) Shopify **products** export CSV (after products exist in admin)

Shopify export must include **Variant SKU** and **Option1 Value** (size). For the same
`itemid`-per-style pattern as your Adidas file, the export should also include **Product ID**.

Usage:
  python3 scripts/mizuno-teamwear/build-syncx-xlsx-from-shopify-export.py \\
    --shopify ~/Downloads/products_export.csv \\
    --feed scripts/mizuno-teamwear/out/final-run-1778062168392-merged-v3/mizuno-syncx-like-adidas.csv \\
    --out scripts/mizuno-teamwear/out/final-run-1778062168392-merged-v3/mizuno-syncx-for-syncx.xlsx

Optional:
  --id-mode product   (default)  itemid = Product ID, same for all sizes of one product (Adidas pattern)
  --id-mode variant              itemid = Variant ID per row (try if product mode fails)

Requires: pip install openpyxl
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

try:
    from openpyxl import Workbook
except ImportError as e:
    raise SystemExit("Install openpyxl: pip3 install openpyxl") from e


def norm_header(h: str) -> str:
    return (h or "").replace("\ufeff", "").strip().lower()


def pick_column(headers_norm: dict[str, str], *candidates: str) -> str | None:
    for c in candidates:
        key = norm_header(c)
        if key in headers_norm:
            return headers_norm[key]
    return None


def read_shopify_export(path: Path) -> tuple[list[str], dict[str, str], list[dict[str, str]]]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    reader = csv.DictReader(text.splitlines())
    if not reader.fieldnames:
        raise SystemExit(f"No headers in {path}")
    fieldnames = list(reader.fieldnames)
    norm_map = {norm_header(h): h for h in fieldnames}
    rows: list[dict[str, str]] = []
    for raw in reader:
        rows.append({k: (raw.get(k) or "").strip() for k in fieldnames})
    return fieldnames, norm_map, rows


def sku_key(s: str) -> str:
    return re.sub(r"\s+", "", (s or "").upper())


def man_code_from_mizuno_sku(sku: str) -> str:
    """SKU format STYLE-COLOR-SIZE -> STYLE (e.g. 32ECA560-09-S -> 32ECA560)."""
    parts = (sku or "").split("-")
    return parts[0] if parts else ""


def main() -> None:
    ap = argparse.ArgumentParser(description="Merge Mizuno stock feed with Shopify export → SyncX XLSX")
    ap.add_argument("--shopify", required=True, type=Path, help="Shopify products CSV export")
    ap.add_argument("--feed", required=True, type=Path, help="Mizuno feed CSV (syncx-like-adidas columns)")
    ap.add_argument("--out", required=True, type=Path, help="Output .xlsx path")
    ap.add_argument(
        "--id-mode",
        choices=("product", "variant"),
        default="product",
        help="itemid source: Product ID (Adidas-style, one id per product) or Variant ID per row",
    )
    args = ap.parse_args()

    _fieldnames, norm_map, shopify_rows = read_shopify_export(args.shopify)
    if not shopify_rows:
        raise SystemExit("Shopify export has no data rows")

    col_sku = pick_column(norm_map, "Variant SKU", "SKU")
    col_opt1 = pick_column(norm_map, "Option1 Value", "option1 value")
    col_title = pick_column(norm_map, "Title")
    col_product_id = pick_column(norm_map, "Product ID", "Product Id")
    col_variant_id = pick_column(norm_map, "Variant ID", "Variant Id")
    col_barcode = pick_column(norm_map, "Variant Barcode", "Barcode", "Variant barcode")

    if not col_sku:
        raise SystemExit(
            "Shopify export must include a Variant SKU column. Found:\n  "
            + ", ".join(shopify_rows[0].keys())
        )
    if args.id_mode == "product" and not col_product_id:
        raise SystemExit(
            "id-mode=product requires Product ID in the Shopify export. "
            "Re-export products from Shopify admin (export includes IDs), or use --id-mode variant.\n"
            f"Columns seen: {', '.join(shopify_rows[0].keys())}"
        )
    if args.id_mode == "variant" and not col_variant_id:
        raise SystemExit(
            "id-mode=variant requires Variant ID in the Shopify export.\n"
            f"Columns seen: {', '.join(shopify_rows[0].keys())}"
        )

    def cell(row: dict[str, str], col: str | None) -> str:
        if not col:
            return ""
        return (row.get(col) or "").strip()

    last_title = ""
    by_sku: dict[str, dict[str, str]] = {}
    for r in shopify_rows:
        t = cell(r, col_title)
        if t:
            last_title = t
        sku = sku_key(cell(r, col_sku))
        if not sku:
            continue
        pid = cell(r, col_product_id)
        vid = cell(r, col_variant_id)
        bc = cell(r, col_barcode)
        opt1 = cell(r, col_opt1)
        by_sku[sku] = {
            "product_id": pid,
            "variant_id": vid,
            "barcode": bc,
            "option1": opt1,
            "title": t or last_title,
        }

    feed_text = args.feed.read_text(encoding="utf-8-sig", errors="replace")
    feed_reader = csv.DictReader(feed_text.splitlines())
    if not feed_reader.fieldnames:
        raise SystemExit(f"No headers in feed {args.feed}")

    out_rows: list[tuple] = []
    missing: list[str] = []

    for fr in feed_reader:
        sku_raw = (fr.get("itemid") or "").strip()
        if not sku_raw:
            continue
        sk = sku_key(sku_raw)
        info = by_sku.get(sk)
        if not info:
            missing.append(sku_raw)
            continue

        if args.id_mode == "product":
            item_id = info["product_id"]
        else:
            item_id = info["variant_id"]

        if not item_id:
            missing.append(sku_raw)
            continue

        title = info["title"] or (fr.get("productname") or "").strip()
        uk_size = info["option1"] or (fr.get("UKSize") or "").strip()
        barcode = info["barcode"] or (fr.get("Barcode") or "").strip()
        man = (fr.get("ManCode") or "").strip() or man_code_from_mizuno_sku(sku_raw)

        qty_raw = (fr.get("Available Physical") or "").strip()
        try:
            qty = int(float(qty_raw)) if qty_raw else 0
        except ValueError:
            qty = 0

        out_rows.append((item_id, man, title, uk_size, barcode, qty))

    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.append(["itemid", "ManCode", "productname", "UKSize", "Barcode", "Available Physical"])
    for row in out_rows:
        ws.append(list(row))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(args.out)

    report = args.out.with_suffix(".report.txt")
    lines = [
        f"Shopify export: {args.shopify}",
        f"Mizuno feed: {args.feed}",
        f"Output: {args.out}",
        f"id-mode: {args.id_mode}",
        f"Matched rows: {len(out_rows)}",
        f"Unmatched SKUs: {len(missing)}",
    ]
    if missing:
        lines.append("First 30 unmatched:")
        lines.extend(f"  {m}" for m in missing[:30])
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print("\n".join(lines))


if __name__ == "__main__":
    main()
