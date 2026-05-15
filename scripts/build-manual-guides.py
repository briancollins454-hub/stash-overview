#!/usr/bin/env python3
"""Inject full how-to guides into INSTRUCTION_MANUAL.html (section 19)."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANUAL = ROOT / "public" / "INSTRUCTION_MANUAL.html"


def steps_html(items: list[str]) -> str:
    rows = "\n".join(
        f'    <div class="step"><div class="step-num">{i}</div><div class="step-text">{s}</div></div>'
        for i, s in enumerate(items, 1)
    )
    return f'  <div class="steps">\n{rows}\n  </div>'


def guide(
    title: str,
    badge: str,
    purpose: str,
    steps: list[str],
    tip: str | None = None,
    warn: str | None = None,
    xref: str | None = None,
) -> str:
    html = f'  <h3 class="no-break">{title} <span class="tab-badge">{badge}</span></h3>\n  <p>{purpose}</p>'
    if xref:
        html += f"\n  <p><em>See also: {xref}</em></p>"
    html += "\n" + steps_html(steps)
    if warn:
        html += f'''
  <div class="callout callout-warn no-break">
    <div class="callout-title">⚠️ Important</div>
    {warn}
  </div>'''
    if tip:
        html += f'''
  <div class="callout callout-tip no-break">
    <div class="callout-title">💡 Tip</div>
    {tip}
  </div>'''
    return html


GUIDES = [
    guide(
        "Briefing (morning overview)",
        "Briefing Tab",
        "Your start-of-day picture: Deco pipeline health, overdue jobs, team workload, and Shopify import gaps. Best used right after a full <span class=\"ui-label\">SYNC</span>.",
        [
            "Open <strong>BRIEFING</strong> from the top navigation bar.",
            "Read the headline badge and hero stats (active orders, in production, blocked, overdue, shipping today).",
            "Read the <strong>Situation Brief</strong> narrative.",
            "Expand <strong>Do First</strong> — click any job row to jump to the <strong>Dashboard</strong>.",
            "Expand <strong>Issues &amp; Root Causes</strong> and <strong>Overdue</strong>; click jobs to open the Dashboard.",
            "Use <strong>Team Workload</strong> — click a staff name for a drill-down list; close with ✕.",
            "Review <strong>Shopify Orders</strong> for import gaps (<strong>Not Imported</strong> warnings).",
        ],
        tip="Briefing opens jobs on the Dashboard, not the Deco tab.",
        xref="Sections 4–6; Section 18 for SYNC.",
    ),
    guide(
        "Daily tasks",
        "Daily Tab",
        "Shared to-do list per calendar day — from Priority Board, finance, issues, AI, or manual notes. Stored in Supabase.",
        [
            "Open <strong>📋 DAILY</strong>; confirm the <strong>Day</strong> date.",
            "Optional: set <strong>View</strong> to one Deco staff member (hides finance rows).",
            "Click <strong>Pull from system (priority order)</strong> for urgent jobs + finance/issue reminders.",
            "Optional: <strong>AI smart scan</strong> for extra suggestions.",
            "Add tasks via <strong>Add your own task…</strong> → <strong>Add</strong>.",
            "Per row: <strong>Hold-up / note</strong>, tick <strong>Checked / reviewed</strong>, then <strong>Complete</strong>.",
            "Use <strong>Find order</strong> or <strong>Open linked page</strong> to jump to related tabs.",
            "Export: set <strong>From</strong> / <strong>To</strong> → <strong>Weekly PDF (all)</strong> or per-person PDFs.",
        ],
        warn="Jobs already marked <strong>Complete</strong> on any day are not re-added by Pull from system.",
        tip="Run <code>migrations/stash_daily_tasks.sql</code> once if tasks fail to save.",
    ),
    guide(
        "Mobile summary",
        "Summary Tab",
        "Phone-friendly KPI tiles — tap to open Dashboard filters or other tabs.",
        [
            "Open <strong>📱 SUMMARY</strong>; refresh after SYNC.",
            "Search order #, customer, or Deco job → tap result → Dashboard.",
            "Tap Shopify tiles: <strong>Late</strong>, <strong>Not on Deco</strong>, <strong>Ready to Ship</strong>, etc.",
            "Tap Priority tiles → opens Priority Board.",
            "Expand Sales/Finance/Credit sections → <strong>Open …</strong> for full tabs.",
        ],
        xref="Section 5 for quick filter meanings.",
    ),
    guide(
        "Live command centre",
        "Command Tab",
        "Full-screen live Shopify pipeline view for wall displays or management check-ins.",
        [
            "Open <strong>⚡ LIVE</strong>.",
            "Switch views: <strong>Overview</strong>, <strong>Pipeline &amp; Trends</strong>, <strong>Clubs</strong>.",
            "Click orders for drawer detail → <strong>Open in Dashboard</strong>.",
            "Press <strong>F</strong> fullscreen; <strong>Esc</strong> to exit.",
        ],
        xref="Briefing / Priority Board for Deco workflow detail.",
    ),
    guide(
        "Priority Board",
        "Priority Board",
        "Deco jobs by stage: Awaiting PO → Stock → Processing → Shipping.",
        [
            "Open <strong>Priority Board</strong> under ORDERS.",
            "Check freshness; click <strong>Sync now</strong> if stale.",
            "Filter <strong>Staff</strong> for stand-ups or PDFs.",
            "Work columns left to right; add <strong>Follow-up note</strong> on PO/Stock rows (auto-syncs to all PCs).",
            "Click jobs to open Dashboard; use time filters (<strong>90D+</strong>, etc.).",
            "Click <strong>Remove Completed</strong> after jobs ship/cancel in Deco.",
            "<strong>PDF</strong> → select sections → Print / Save as PDF.",
        ],
        warn="Wait for Remove Completed to finish before SYNC, or cleared jobs can reappear.",
        tip="Notes need <code>stash_priority_notes.sql</code> in Supabase once.",
        xref="Section 3 for status meanings.",
    ),
    guide(
        "Ops Centre",
        "Ops Centre Tab",
        "Returns log, artwork approvals, and shipping label logging. (Alert rules are under the 🔔 header bell.)",
        [
            "<strong>Returns</strong> — Order #, item, reason → <strong>Save</strong>; add <strong>Remake Job #</strong> if needed.",
            "<strong>Artwork Approvals</strong> — Order #, design, notes → <strong>Save</strong>.",
            "<strong>Shipping Labels</strong> — log carrier/tracking for shipments outside Fulfill.",
        ],
        xref="Section 12 for batch Fulfill shipping.",
    ),
    guide(
        "Orders by tag",
        "Orders by Tag",
        "Orders grouped under each Shopify tag — for club campaigns and seasonal runs.",
        [
            "Open <strong>Orders by tag</strong>; search and set date preset.",
            "Toggle <strong>Refunds</strong>, <strong>Has Deco #</strong>, <strong>No Deco #</strong>.",
            "<strong>Expand all</strong> / <strong>Collapse all</strong>; work orders inside each tag.",
        ],
        tip="Same order can appear under multiple tags — intentional.",
    ),
    guide(
        "Kanban board",
        "Kanban Tab",
        "Visual pipeline of orders by stage — drag cards or use filters for team stand-ups.",
        [
            "Open <strong>Kanban</strong> under ORDERS.",
            "Use column filters and search to narrow the board.",
            "Click a card to open order detail on the Dashboard.",
            "Move cards between stages when your process allows (or update in Deco and SYNC).",
        ],
        xref="Sections 6–7 for Dashboard filters and status colours.",
    ),
    guide(
        "Fulfillment",
        "Fulfill Tab",
        "Batch pick, pack, and ship linked Shopify orders.",
        [
            "Open <strong>Fulfill</strong> after orders are linked (Sections 9–11).",
            "Filter by ready-to-ship / location as needed.",
            "Select orders → generate labels or mark shipped per your carrier workflow.",
            "Confirm stock and Deco status before shipping.",
        ],
        xref="Section 12–13 for full fulfilment workflow.",
    ),
    guide(
        "Reports",
        "Reports Tab",
        "Operational and carrier reports — export or print.",
        [
            "Open <strong>Reports</strong> under ANALYTICS.",
            "Pick a report type from the list (completion, carrier, stock, etc.).",
            "Set date range and filters → <strong>Run</strong> or <strong>Export</strong>.",
            "Use PDF/CSV for management packs.",
        ],
        xref="Section 14 for report catalogue.",
    ),
    guide(
        "Stock Take",
        "Stock Take Tab",
        "Barcode count sessions for physical stock — commit when done.",
        [
            "Open <strong>Stock Take</strong>; wait for scan index / catalog to load.",
            "Start a new session or reopen an open one; use <strong>Committed counts</strong> to review past sessions.",
            "Scan barcodes or type EAN; adjust qty per line.",
            "<strong>Commit</strong> when finished; print PDF from committed sessions.",
        ],
        warn="On mobile: Close camera, wait a moment, then Enable camera; allow browser camera permission on HTTPS.",
        xref="Section 16 for full Stock Take detail.",
    ),
    guide(
        "Auto Linker",
        "Auto Linker Tab",
        "Bulk-suggest Shopify ↔ Deco links by EAN and fuzzy match.",
        [
            "Open <strong>Auto Linker</strong>; review suggestion count.",
            "Toggle <strong>High Confidence Only</strong> or <strong>Show All</strong>.",
            "Per row: <strong>Apply</strong> or <strong>Dismiss</strong>; or <strong>Apply All High</strong>.",
        ],
        xref="Sections 10–11 after linking.",
    ),
    guide(
        "Production tab",
        "Production Tab",
        "Intelligence analytics, Deco production table (print/filter), priority queue, and calendar.",
        [
            "Scroll the tab: <strong>Production Intelligence</strong> → risks and throughput.",
            "<strong>Deco Production Table</strong> → search, columns, <strong>Print / Save as PDF</strong>.",
            "<strong>Priority Queue</strong> and <strong>Production Calendar</strong> for planning.",
        ],
    ),
    guide(
        "Shop Floor",
        "Shop Floor Tab",
        "Slack feeds: Print, Embroidery, Delivery updates.",
        [
            "Open <strong>Shop Floor</strong>; read the three channel feeds.",
            "Use with Priority Board for actionable job lists.",
        ],
        tip="Requires Slack sync configured server-side.",
    ),
    guide(
        "Deco Network",
        "Deco Tab",
        "Direct Deco job search and linking.",
        [
            "Open <strong>Deco Network</strong>; search job #.",
            "Link and map items (Sections 9–11).",
        ],
    ),
    guide(
        "Made to Order (MTO)",
        "MTO Tab",
        "Per-line Deco jobs for bespoke items.",
        [
            "Open <strong>Made to Order</strong>; filter by club tags if needed.",
            "Link lines via <strong>Bulk Link MTO Items</strong> or per row.",
            "Refresh job status after linking.",
        ],
        xref="Section 9 MTO badges.",
    ),
    guide(
        "Stock Manager",
        "Stock Manager Tab",
        "Branch stock, returns, master catalogue — feeds Dashboard STOCK %.",
        [
            "<strong>Allocation Hub</strong> — dispatch / allocate stock.",
            "<strong>Add Stock</strong> / <strong>View Stock</strong> — quantities and EANs.",
            "<strong>Returns</strong> — scan Shopify order for returns.",
            "<strong>Master Data</strong> — CSV import for reference products.",
        ],
        xref="Section 16 Stock Take for barcode counts.",
    ),
    guide(
        "Shopify Inventory",
        "Inventory Tab",
        "Shopify warehouse stock (not branch physical stock).",
        [
            "<strong>Configure Warehouse Locations</strong> → <strong>Save</strong>.",
            "<strong>Load inventory</strong>; filter out/low/in stock.",
            "Search product → <strong>Edit</strong> qty → <strong>Save</strong>.",
        ],
    ),
    guide(
        "Wholesale Lookup",
        "Wholesale Tab",
        "Compare supplier price feeds and stock for a product code.",
        [
            "Search product code; review style matrix and <strong>best buy</strong>.",
            "Enter <strong>qty needed</strong> for fulfilment check.",
            "Admins: <strong>Upload Wholesaler Feed</strong> CSV.",
        ],
    ),
    guide(
        "Issue Log",
        "Issue Log Tab",
        "Log and track production problems.",
        [
            "<strong>New Request</strong> → name, type, description → save.",
            "Resolve with notes; feeds Daily tasks Pull from system.",
        ],
    ),
    guide(
        "Intel tab",
        "Intel Tab",
        "Auto-match, duplicate detector, forecast.",
        [
            "<strong>Auto-Match Panel</strong> — apply Shopify↔Deco suggestions.",
            "<strong>Duplicate Detector</strong> — find duplicate Deco jobs.",
            "<strong>Forecast Panel</strong> — capacity outlook.",
        ],
    ),
    guide(
        "Efficiency dashboard",
        "Efficiency Tab",
        "Dispatch efficiency metrics.",
        ["Open tab; review charts; pair with Reports completion/carrier reports."],
    ),
    guide(
        "Process Analyst",
        "Analyst Tab",
        "Ask questions about order data in plain English.",
        [
            "Type or use suggestion chips.",
            "Verify answers on Dashboard before acting.",
        ],
    ),
    guide(
        "Revenue dashboard",
        "Revenue Tab",
        "Revenue trends by period.",
        [
            "Select <strong>ALL</strong> / <strong>7D</strong> / <strong>30D</strong>.",
            "Review charts and top customers.",
        ],
    ),
    guide(
        "Sales analytics",
        "Sales Tab",
        "Sales exports for management.",
        [
            "Set date filters → <strong>Refresh</strong>.",
            "<strong>Export</strong> or <strong>Export Detail</strong> CSV.",
        ],
    ),
    guide(
        "Finance hub",
        "Finance (£ icon)",
        "Deco AR, QuickBooks, exports.",
        [
            "<strong>Sync Recent</strong> daily; <strong>Full Reload</strong> weekly.",
            "Connect/sync QuickBooks if used.",
            "Export summary/Excel; click jobs → Dashboard.",
        ],
    ),
    guide(
        "Shipped not invoiced",
        "Shipped Not Invoiced",
        "Shipped in Deco, not invoiced in accounts.",
        ["Review outstanding list; raise invoices in accounts."],
    ),
    guide(
        "Credit block list",
        "Credit Block",
        "Customers on credit stop.",
        ["Review blocked customers; clear before shipping."],
    ),
    guide(
        "Unpaid orders",
        "Unpaid Orders",
        "Payment outstanding before fulfilment.",
        [
            "Re-read finance cache or pull from Deco.",
            "Print chase list; use authorise actions per process.",
        ],
    ),
    guide(
        "Email digest",
        "Digest Tab",
        "Scheduled team summary emails.",
        [
            "Add recipients; pick daily/weekly.",
            "Preview → send (needs server email config).",
        ],
    ),
    guide(
        "User management",
        "Users Tab",
        "Staff logins and tab permissions (admin).",
        [
            "<strong>Add User</strong> with role or custom tab list.",
            "Refresh; edit/disable when staff leave.",
        ],
    ),
    guide(
        "Cloud health",
        "Cloud Health Tab",
        "Local vs cloud data diagnostics.",
        [
            "Check per-table counts.",
            "<strong>Run Integrity Check</strong> if drift suspected.",
        ],
    ),
    guide(
        "Alerts — stock &amp; rules",
        "Alerts",
        "<strong>Alerts tab</strong>: stock reorder + supplier PO. <strong>🔔 bell</strong>: Alert Manager rules.",
        [
            "Stock Alerts — set reorder points.",
            "Supplier Reorder — Copy/Download PO.",
            "Bell → New Alert Rule for automated notifications.",
        ],
        xref="Section 17 order notes.",
    ),
]


def build_section_19() -> str:
    body = "\n".join(GUIDES)
    return f'''<!-- SECTION 19: HOW TO USE EVERY FEATURE -->
<div class="section page-break">
  <div class="section-header">
    <div class="section-num">19</div>
    <div>
      <h2>How to Use Every Feature</h2>
    </div>
  </div>

  <p>Part I (sections 1–18) explains the Dashboard, linking, fulfilment, reports, stock take, notes, and sync in depth. Below are <strong>step-by-step instructions for every tab</strong>, using the same labels as the app.</p>

  <div class="callout callout-info no-break">
    <div class="callout-title">Detailed elsewhere</div>
    Sections <strong>4–8</strong> Dashboard &amp; Kanban · <strong>9–11</strong> Linking · <strong>12–13</strong> Fulfill · <strong>14</strong> Reports · <strong>15–16</strong> Stock · <strong>17–18</strong> Notes &amp; SYNC
  </div>

  <h3>Daily operations</h3>
{body}

  <h3 class="page-break">Orders &amp; linking</h3>
  <p>Dashboard linking detail: Sections <strong>9–11</strong>. Auto Linker steps above complement bulk linking.</p>

  <h3>Production &amp; stock</h3>
  <p>Stock Take full workflow: <strong>Section 16</strong>. Stock Manager overview: <strong>Section 15</strong>.</p>

  <h3>Analytics &amp; finance</h3>
  <p>All Reports: <strong>Section 14</strong>. Finance and Intel steps are in the guides above.</p>

  <div class="callout callout-info">
    <div class="callout-title">One-time database setup</div>
    Run in Supabase if a feature fails to save: <code>stash_stock_take.sql</code>, <code>stash_supplier_catalog.sql</code>, <code>stash_priority_notes.sql</code>, <code>stash_daily_tasks.sql</code>.
  </div>
</div>
'''


def main() -> None:
    text = MANUAL.read_text()
    text = text.replace("Version 4.2", "Version 5.0")
    text = text.replace("VERSION 4.2", "VERSION 5.0")
    text = text.replace(
        "Complete Tab Reference",
        "How to Use Every Feature",
    )

    start = text.index("<!-- SECTION 19:")
    end = text.index("<!-- ████████████████████████████████████████████████████ -->\n<!-- SECTION 20:")
    text = text[:start] + build_section_19() + "\n\n" + text[end:]

    # Daily checklist add briefing
    if "Open <strong>BRIEFING</strong>" not in text:
        text = text.replace(
            '<div class="step"><div class="step-num">2</div><div class="step-text">Check the <strong>NOT ON DECO</strong>',
            '<div class="step"><div class="step-num">2</div><div class="step-text">Open <strong>BRIEFING</strong> or <strong>📋 DAILY</strong> for today&apos;s priorities</div></div>\n    <div class="step"><div class="step-num">3</div><div class="step-text">Check the <strong>NOT ON DECO</strong>',
        )

    MANUAL.write_text(text)
    print(f"OK — {MANUAL.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
