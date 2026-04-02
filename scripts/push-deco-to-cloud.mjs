#!/usr/bin/env node
/**
 * One-time script: Fetch ALL Deco jobs from DecoNetwork API and push to Supabase.
 * This avoids waiting for a browser deep scan — runs server-side directly.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Parse .env.local manually (no dotenv dependency needed)
const envPath = resolve(import.meta.dirname, '../.env.local');
const envContent = readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) return;
  const key = trimmed.slice(0, eqIdx).trim();
  const value = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = value;
});

const DECO_DOMAIN = process.env.DECO_DOMAIN;
const DECO_USERNAME = process.env.DECO_USERNAME;
const DECO_PASSWORD = process.env.DECO_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

if (!DECO_DOMAIN || !DECO_USERNAME || !DECO_PASSWORD) {
  console.error('Missing DECO credentials in .env.local');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE credentials in .env.local');
  process.exit(1);
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));

const standardizeSize = (s) => {
  if (!s) return '';
  const cleaned = s.trim().toUpperCase();
  const map = { 'EXTRA SMALL': 'XS', 'SMALL': 'S', 'MEDIUM': 'M', 'LARGE': 'L', 'EXTRA LARGE': 'XL', 'XX LARGE': '2XL', 'XXX LARGE': '3XL' };
  return map[cleaned] || s.trim();
};

function parseDecoItems(job) {
  if (!job?.order_lines || !Array.isArray(job.order_lines)) return [];
  const optionNameMap = {};
  job.order_lines.forEach(line => {
    if (line?.fields) {
      line.fields.forEach(field => {
        if (field.options) {
          field.options.forEach(opt => { if (opt.option_id) optionNameMap[opt.option_id] = opt.code || opt.name || ''; });
        }
      });
    }
  });
  const items = [];
  job.order_lines.forEach(line => {
    if (!line || (line.item_type !== 0 && line.item_type !== 25)) return;
    const colorName = line.product_color?.name || '';
    const potentialEan = line.barcode || line.ean || line.gtin || line.upc || line.product?.barcode || '';
    if (line.workflow_items?.length > 0) {
      line.workflow_items.forEach(wf => {
        const variantName = wf.option_id && optionNameMap[wf.option_id] ? standardizeSize(optionNameMap[wf.option_id]) : '';
        const uniqueName = `${line.product_name || 'Item'}${colorName ? ` - ${colorName}` : ''}${variantName ? ` - ${variantName}` : ''}`;
        items.push({
          productCode: line.product_code || '', vendorSku: wf.vendor_sku || line.sku || '',
          name: uniqueName, ean: wf.barcode || wf.ean || potentialEan,
          quantity: wf.qty_to_fulfill || 0,
          isReceived: wf.procurement_status >= 60, isProduced: wf.production_status >= 80, isShipped: wf.shipping_status >= 80,
          procurementStatus: wf.procurement_status || 0, productionStatus: wf.production_status || 0, shippingStatus: wf.shipping_status || 0,
          status: wf.shipping_status >= 80 ? 'Shipped' : (wf.production_status >= 80 ? 'Produced' : (wf.procurement_status >= 60 ? 'Awaiting Production' : 'Awaiting Stock')),
          unitPrice: parseFloat(line.unit_price) || undefined,
          totalPrice: parseFloat(line.total_price) || undefined,
        });
      });
    } else {
      items.push({
        productCode: line.product_code || '', vendorSku: line.sku || '',
        name: line.product_name || 'Item', ean: potentialEan,
        quantity: parseInt(line.qty) || 0,
        status: line.production_status === 3 ? 'Shipped' : (line.production_status === 2 ? 'Produced' : 'Ordered'),
        isReceived: true, isProduced: (line.production_status || 0) >= 2, isShipped: (line.production_status || 0) >= 3,
        procurementStatus: 60, productionStatus: line.production_status >= 2 ? 80 : 20, shippingStatus: line.production_status === 3 ? 80 : 0,
        unitPrice: parseFloat(line.unit_price) || undefined,
        totalPrice: parseFloat(line.total_price) || undefined,
      });
    }
  });
  return items;
}

const statusMap = { 0: 'Pending', 1: 'In Progress', 2: 'Ready', 3: 'Completed', 4: 'Cancelled', 5: 'On Hold' };
function mapDecoStatus(s) {
  if (typeof s === 'number') return statusMap[s] || `Status ${s}`;
  if (typeof s === 'string') {
    const n = s.toLowerCase();
    if (n.includes('cancel')) return 'Cancelled';
    if (n.includes('complet') || n.includes('ship')) return 'Completed';
    if (n.includes('progress') || n.includes('production')) return 'In Progress';
    if (n.includes('ready')) return 'Ready';
    if (n.includes('hold')) return 'On Hold';
    return s;
  }
  return 'Unknown';
}

function buildDecoJob(job, items) {
  const custName = job.billing_details?.company || `${job.billing_details?.firstname || ''} ${job.billing_details?.lastname || ''}`.trim() || 'Unknown';
  return {
    id: job.order_id.toString(), jobNumber: job.order_id.toString(),
    poNumber: job.customer_po_number || '', jobName: job.job_name || 'Deco Job',
    customerName: custName, status: mapDecoStatus(job.order_status_name || job.order_status),
    dateOrdered: job.date_ordered, productionDueDate: job.date_scheduled,
    dateDue: job.date_due, dateShipped: job.date_shipped || job.date_completed,
    itemsProduced: items.filter(i => i.isProduced).length, totalItems: items.length,
    notes: Array.isArray(job.notes) ? job.notes.map(n => n.content || '').join(' | ') : '',
    productCode: items[0]?.productCode || '', items,
    orderTotal: parseFloat(job.total) || parseFloat(job.order_total) || undefined,
    orderSubtotal: parseFloat(job.subtotal) || parseFloat(job.order_subtotal) || undefined,
    orderTax: parseFloat(job.tax) || parseFloat(job.order_tax) || undefined,
    paymentStatus: job.payment_status_name || job.payment_status?.toString() || undefined,
    outstandingBalance: parseFloat(job.outstanding_balance) || 0,
    billableAmount: parseFloat(job.billable_amount) || 0,
  };
}

// --- STEP 1: Create table if not exists ---
async function ensureTable() {
  console.log('Checking/creating stash_deco_jobs table...');
  // Try a harmless read first
  const res = await fetch(`${SUPABASE_URL}/rest/v1/stash_deco_jobs?select=job_number&limit=1`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (res.status === 404 || res.status === 406) {
    console.log('Table does not exist. You need to create it in Supabase SQL Editor:');
    console.log(`
CREATE TABLE stash_deco_jobs (
  job_number TEXT PRIMARY KEY,
  job_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE stash_deco_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON stash_deco_jobs FOR ALL USING (true) WITH CHECK (true);
    `);
    console.log('Create the table, then re-run this script.');
    process.exit(1);
  }
  if (res.ok) {
    const existing = await res.json();
    console.log(`Table exists. Current rows readable: ${Array.isArray(existing) ? existing.length : '?'} (limited to 1)`);
  } else {
    const errText = await res.text();
    console.error(`Unexpected response checking table: ${res.status} ${errText}`);
    process.exit(1);
  }
}

// --- STEP 2: Fetch ALL Deco jobs ---
async function fetchAllDecoJobs() {
  const LOOKBACK_DAYS = 365;
  const minDate = new Date();
  minDate.setDate(minDate.getDate() - LOOKBACK_DAYS);
  const dateStr = minDate.toISOString().split('T')[0] + ' 00:00:00';

  let allJobs = [];
  let offset = 0;
  const BATCH_SIZE = 250;
  const MAX_JOBS = 5000;
  let hasMore = true;

  console.log(`Fetching Deco jobs from last ${LOOKBACK_DAYS} days...`);

  while (hasMore && offset < MAX_JOBS) {
    const params = new URLSearchParams({
      username: DECO_USERNAME,
      password: DECO_PASSWORD,
      limit: BATCH_SIZE.toString(),
      offset: offset.toString(),
      field: '1',
      condition: '4',
      date1: dateStr,
      include_workflow_data: '1',
      skip_login_token: '1'
    });

    const url = `https://${DECO_DOMAIN}/api/json/manage_orders/find?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const data = await res.json();

    if (data.response_status) {
      const code = parseInt(data.response_status.code);
      if (code === 10002) { console.error('Auth failed — check Deco credentials'); process.exit(1); }
      if (code !== 10001) { console.error(`Deco error: ${data.response_status.description}`); process.exit(1); }
    }

    const orders = data.orders || [];
    allJobs.push(...orders);
    console.log(`  Fetched batch ${Math.floor(offset / BATCH_SIZE) + 1}: ${orders.length} jobs (total so far: ${allJobs.length}, API total: ${data.total || 'unknown'})`);

    if (orders.length === 0 || allJobs.length >= (data.total || Infinity)) {
      hasMore = false;
    } else {
      offset += orders.length;
      await delay(200);
    }
  }

  console.log(`Total raw Deco jobs fetched: ${allJobs.length}`);

  // Transform to DecoJob format
  const transformed = allJobs.map(job => {
    const items = parseDecoItems(job);
    return buildDecoJob(job, items);
  });

  console.log(`Transformed to ${transformed.length} DecoJob objects`);
  return transformed;
}

// --- STEP 3: Push to Supabase ---
async function pushToSupabase(jobs) {
  const BATCH_SIZE = 20;
  let pushed = 0;
  let errors = 0;

  console.log(`Pushing ${jobs.length} jobs to Supabase in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const payload = batch.map(j => ({
      job_number: j.jobNumber,
      job_data: j,
      updated_at: new Date().toISOString()
    }));

    const res = await fetch(`${SUPABASE_URL}/rest/v1/stash_deco_jobs`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal, resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      pushed += batch.length;
    } else {
      const errText = await res.text();
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${res.status} ${errText}`);
      errors += batch.length;
    }

    if ((i + BATCH_SIZE) % 200 === 0) {
      process.stdout.write(`  Progress: ${pushed} pushed, ${errors} errors\r`);
    }
  }

  console.log(`\nDone! Pushed: ${pushed}, Errors: ${errors}`);
}

// --- Main ---
async function main() {
  await ensureTable();
  const jobs = await fetchAllDecoJobs();
  if (jobs.length === 0) {
    console.log('No jobs to push.');
    return;
  }
  await pushToSupabase(jobs);
  console.log('\n✅ All Deco jobs are now in Supabase. Every device will pick them up on next sync.');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
