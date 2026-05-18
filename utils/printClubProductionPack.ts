import type { ProductionPackReport } from './clubProductionPack';
import {
  buildWorkRowsFromReport,
  formatProductionPackItemMeta,
  productionPackDoneStorageKey,
  type ProductionPackWorkRow,
} from './clubProductionPack';

function esc(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(raw: string): string {
  return esc(raw).replace(/'/g, '&#39;');
}

function fmtDate(ymd: string): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtOrderDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function renderPersCell(row: ProductionPackWorkRow): string {
  const chips = row.personalizationChips;
  if (chips.length === 0) {
    if (row.personalization.trim()) {
      const id = `${row.id}:plain`;
      return `<button type="button" class="pers-chip copyable" data-chip-id="${escAttr(id)}" data-copy="${escAttr(row.personalization)}"><span class="pers-label">Text</span><span class="pers-value">${esc(row.personalization)}</span></button>`;
    }
    return '<span class="muted">Plain stock</span>';
  }
  return `<div class="pers-chips">${chips
    .map(
      chip =>
        `<button type="button" class="pers-chip copyable" data-chip-id="${escAttr(chip.id)}" data-copy="${escAttr(chip.value)}"><span class="pers-label">${esc(chip.label)}</span><span class="pers-value">${esc(chip.value)}</span></button>`
    )
    .join('')}</div>`;
}

function renderWorkRow(row: ProductionPackWorkRow, index: number): string {
  const chipCount = row.personalizationChips.length;
  const title =
    chipCount === 0 && !row.personalization.trim()
      ? 'Click row to mark done'
      : 'Click each field to copy — row turns green when all are done';
  return `<tr class="work-row" data-row-id="${escAttr(row.id)}" data-chip-count="${chipCount}" title="${escAttr(title)}">
    <td class="num">${index + 1}</td>
    <td class="product">
      <strong>${esc(row.itemName)}</strong>
      <div class="sub muted">${esc(formatProductionPackItemMeta(row))}</div>
    </td>
    <td class="size-col">${row.sizeLabel ? `<strong>${esc(row.sizeLabel)}</strong>` : '—'}</td>
    <td class="num qty">${row.quantity}</td>
    <td class="pers-cell">${renderPersCell(row)}</td>
  </tr>`;
}

function buildInteractiveScript(storageKey: string): string {
  return `
(function () {
  var STORAGE_KEY = ${JSON.stringify(storageKey)};
  var toastEl = document.getElementById('toast');

  function loadDone() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();
      var arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) {
      return new Set();
    }
  }

  function saveDone(set) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {}
  }

  var done = loadDone();

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  function rowIsComplete(row) {
    var chips = row.querySelectorAll('.pers-chip[data-chip-id]');
    if (chips.length === 0) {
      var rid = row.getAttribute('data-row-id');
      return rid && done.has(rid);
    }
    for (var i = 0; i < chips.length; i++) {
      var cid = chips[i].getAttribute('data-chip-id');
      if (!cid || !done.has(cid)) return false;
    }
    return true;
  }

  function updateProgress() {
    var chips = document.querySelectorAll('.pers-chip[data-chip-id]');
    var plainRows = document.querySelectorAll('.work-row[data-chip-count="0"]');
    var total = chips.length + plainRows.length;
    var n = 0;
    chips.forEach(function (btn) {
      var id = btn.getAttribute('data-chip-id');
      if (id && done.has(id)) n++;
    });
    plainRows.forEach(function (row) {
      var id = row.getAttribute('data-row-id');
      if (id && done.has(id)) n++;
    });
    var el = document.getElementById('progress');
    if (el) el.textContent = n + ' / ' + total + ' fields done';
  }

  function applyDoneState() {
    document.querySelectorAll('.pers-chip[data-chip-id]').forEach(function (btn) {
      var id = btn.getAttribute('data-chip-id');
      if (id && done.has(id)) btn.classList.add('chip-done');
      else btn.classList.remove('chip-done');
    });
    document.querySelectorAll('.work-row').forEach(function (row) {
      if (rowIsComplete(row)) row.classList.add('row-done');
      else row.classList.remove('row-done');
    });
    updateProgress();
  }

  document.querySelectorAll('.work-row').forEach(function (row) {
    row.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.pers-chip')) return;
      var chipCount = parseInt(row.getAttribute('data-chip-count') || '0', 10);
      if (chipCount > 0) return;
      var id = row.getAttribute('data-row-id');
      if (!id) return;
      if (done.has(id)) done.delete(id);
      else done.add(id);
      saveDone(done);
      applyDoneState();
    });
  });

  document.querySelectorAll('.pers-chip[data-chip-id]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var text = btn.getAttribute('data-copy') || '';
      var label = btn.querySelector('.pers-label');
      var labelText = label ? label.textContent : '';
      function ok() {
        var id = btn.getAttribute('data-chip-id');
        if (id) {
          done.add(id);
          saveDone(done);
        }
        applyDoneState();
        showToast('Copied ' + (labelText ? labelText + ': ' : '') + text);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok).catch(function () {
          window.prompt('Copy:', text);
          ok();
        });
      } else {
        window.prompt('Copy:', text);
        ok();
      }
    });
  });

  var resetBtn = document.getElementById('reset-done');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (!confirm('Clear all done marks for this pack?')) return;
      done = new Set();
      saveDone(done);
      applyDoneState();
    });
  }

  var printBtn = document.getElementById('print-btn');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

  applyDoneState();
})();
`;
}

/** Full interactive HTML (open in browser — click rows to mark done, click text to copy). */
export function buildClubProductionPackPrintHtml(report: ProductionPackReport): string {
  const { filters, orders, stats } = report;
  const storageKey = productionPackDoneStorageKey(filters);
  const { pivotRows, orderRows } = buildWorkRowsFromReport(report);

  const now = new Date();
  const printed = now.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const pivotTableRows = pivotRows.map((r, i) => renderWorkRow(r, i)).join('');

  const orderBlocks = orders
    .map(o => {
      const oLines = orderRows.filter(r => r.orderNumber === o.orderNumber);
      const rows = oLines.map((r, i) => renderWorkRow(r, i)).join('');
      return `<section class="order-card">
        <header>
          <div>
            <h3>${esc(o.orderNumber)}</h3>
            <p class="cust">${esc(o.customerName)}${o.email ? ` · ${esc(o.email)}` : ''}</p>
          </div>
          <div class="order-meta">
            <span>${esc(fmtOrderDate(o.orderDate))}</span>
            <span class="units">${o.totalUnits} unit${o.totalUnits === 1 ? '' : 's'}</span>
          </div>
        </header>
        <table class="work-table">
          <thead>
            <tr>
              <th>#</th><th>Item</th><th>Size</th><th>Qty</th><th>Personalisation</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5" class="muted">No lines</td></tr>'}</tbody>
        </table>
      </section>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Production pack — ${esc(filters.tag)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #0f172a; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; padding: 24px; font-size: 11px; line-height: 1.45; }
    .toolbar {
      position: sticky; top: 0; z-index: 20;
      background: #1e1b4b; color: #fff; padding: 12px 16px; margin: 0 0 20px;
      display: flex; flex-wrap: wrap; align-items: center; gap: 10px; border-radius: 8px;
    }
    .toolbar .hint { flex: 1; min-width: 200px; font-size: 11px; opacity: 0.9; }
    .toolbar button {
      padding: 8px 14px; border: none; border-radius: 8px; font-weight: 800; font-size: 11px; cursor: pointer;
    }
    #print-btn { background: #6366f1; color: #fff; }
    #reset-done { background: rgba(255,255,255,0.15); color: #fff; border: 1px solid rgba(255,255,255,0.3); }
    #progress { font-weight: 800; font-size: 12px; padding: 6px 10px; background: rgba(255,255,255,0.12); border-radius: 6px; }
    .callout-box {
      background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 11px; color: #1e40af;
    }
    .cover { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px solid #1e1b4b; }
    .cover h1 { margin: 0 0 6px; font-size: 22px; }
    .cover .tag { display: inline-block; background: #eef2ff; color: #3730a3; padding: 4px 12px; border-radius: 999px; font-weight: 800; font-size: 12px; margin-bottom: 8px; }
    .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; background: #f8fafc; }
    .kpi span { display: block; font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; font-weight: 800; }
    .kpi strong { font-size: 16px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #1e1b4b; margin: 20px 0 8px; border-bottom: 2px solid #c7d2fe; padding-bottom: 4px; }
    .work-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .work-table th, .work-table td { border: 1px solid #cbd5e1; padding: 8px 10px; vertical-align: middle; }
    .work-table th { background: #f1f5f9; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800; }
    .work-row { cursor: pointer; transition: background 0.15s; }
    .work-row:hover { background: #f5f3ff !important; }
    .work-row.row-done { background: #dcfce7 !important; }
    .work-row.row-done td { color: #14532d; }
    .work-row.row-done .pers-chip { background: #bbf7d0; border-color: #86efac; color: #166534; }
    td.size-col { text-align: center; font-size: 15px; font-weight: 900; color: #1e1b4b; min-width: 48px; }
    td.size-col strong { font-size: 16px; }
    td.mono { font-family: ui-monospace, monospace; font-size: 9px; }
    td.vendor, td.color { font-size: 10px; }
    td.product .sub { font-size: 9px; color: #64748b; margin-top: 2px; }
    td.qty { text-align: center; font-weight: 800; }
    .pers-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .pers-chip {
      display: inline-flex; flex-direction: column; align-items: flex-start; margin: 0; padding: 6px 10px;
      background: #f5f3ff; border: 1px solid #c4b5fd; border-radius: 8px;
      color: #5b21b6; cursor: copy; text-align: left; max-width: 200px;
    }
    .pers-chip .pers-label { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.85; }
    .pers-chip .pers-value { font-size: 13px; font-weight: 800; line-height: 1.2; margin-top: 2px; }
    .pers-chip:hover { background: #ede9fe; }
    .pers-chip.chip-done { background: #bbf7d0 !important; border-color: #22c55e !important; color: #166534 !important; box-shadow: 0 0 0 2px rgba(34,197,94,0.35); }
    .work-row.row-done .pers-chip.chip-done { background: #86efac !important; }
    .muted { color: #94a3b8; }
    .order-card { margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
    .order-card header { display: flex; justify-content: space-between; padding: 10px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .order-card h3 { margin: 0; font-size: 13px; }
    #toast {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(120%);
      background: #1e1b4b; color: #fff; padding: 10px 18px; border-radius: 8px; font-weight: 700; font-size: 12px;
      z-index: 100; transition: transform 0.2s; box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    #toast.show { transform: translateX(-50%) translateY(0); }
    .page-break { page-break-before: always; break-before: page; margin-top: 24px; }
    @media print {
      .toolbar, #toast { display: none !important; }
      body { padding: 8mm; }
      .work-row { cursor: default; }
      .pers-chip { border: 1px solid #999; }
      .work-row.row-done { background: #dcfce7 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div id="toast"></div>
  <div class="toolbar no-print">
    <span class="hint">Click each <strong>labelled field</strong> to copy (stays green). Row turns green when every field on that line is done. Plain stock: click the row.</span>
    <span id="progress">0 / 0 done</span>
    <button type="button" id="reset-done">Reset done</button>
    <button type="button" id="print-btn">Print / Save PDF</button>
  </div>
  <div class="callout-box no-print">
    This is an interactive worksheet in your browser (not a static PDF). Done marks are saved in local storage for this tag + date range. Saving as PDF will keep green rows but won&apos;t be clickable.
  </div>
  <div class="cover">
    <div class="tag">${esc(filters.tag)}</div>
    <h1>Production pack</h1>
    <p class="sub">${esc(fmtDate(filters.dateFrom))} – ${esc(fmtDate(filters.dateTo))} · Unfulfilled · ${esc(printed)}</p>
    <div class="kpis">
      <div class="kpi"><span>Garments to make</span><strong>${pivotRows.length}</strong></div>
      <div class="kpi"><span>Orders</span><strong>${stats.orderCount}</strong></div>
      <div class="kpi"><span>Total units</span><strong>${stats.totalUnits}</strong></div>
    </div>
  </div>

  <h2>Pick list — by product</h2>
  <p class="muted" style="margin:0 0 8px;">Sorted by product, colour, size. One row per garment when personalised.</p>
  <table class="work-table">
    <thead>
      <tr>
        <th>#</th><th>Item</th><th>Size</th><th>Qty</th><th>Personalisation</th>
      </tr>
    </thead>
    <tbody>${pivotTableRows || '<tr><td colspan="5" class="muted">No lines</td></tr>'}</tbody>
  </table>

  <div class="page-break"></div>
  <h2>Orders — detail</h2>
  ${orderBlocks || '<p class="muted">No orders</p>'}

  <script>${buildInteractiveScript(storageKey)}</script>
</body>
</html>`;

  return html;
}

function openHtmlViaDocumentWrite(html: string): boolean {
  const w = window.open('', 'stash-production-pack-print', 'width=1100,height=900');
  if (!w) return false;
  try {
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    return true;
  } catch {
    try {
      w.close();
    } catch {
      /* ignore */
    }
    return false;
  }
}

function openHtmlInNewTab(html: string): boolean {
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, '_blank');
    if (opened) {
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
      return true;
    }
    URL.revokeObjectURL(url);
  } catch {
    /* fall through */
  }
  return false;
}

export function openClubProductionPackPrint(report: ProductionPackReport): void {
  const html = buildClubProductionPackPrintHtml(report);
  if (!html || report.stats.lineCount <= 0) {
    window.alert('Nothing to print for this selection.');
    return;
  }

  if (openHtmlViaDocumentWrite(html)) return;
  if (openHtmlInNewTab(html)) return;

  window.alert(
    'Could not open the production pack. Allow pop-ups for this site and try again.'
  );
}
