export interface LabelPrinterLineItem {
  id: string;
  description: string;
  quantity: number;
  isReceived?: boolean;
  receivedDate?: string;
}

export interface LabelPrinterJob {
  jobNumber: string;
  customerName: string;
  jobName: string;
  dateScheduled?: string;
  items: LabelPrinterLineItem[];
}

export function mapOrderToJob(order: any): LabelPrinterJob {
  const customerName =
    order.billing_details?.company
    || `${order.billing_details?.firstname || ''} ${order.billing_details?.lastname || ''}`.trim()
    || 'Unknown Customer';

  const groups = new Map<string, {
    baseDesc: string;
    color: string;
    isReceived: boolean;
    processedDate: string;
    sizes: string[];
    totalQty: number;
    rawId: string | number;
  }>();

  for (const line of order.order_lines || []) {
    const color = line.product_color?.name || '';
    const baseDesc = line.product_name || 'Unknown Item';
    const processedDate = line.processed_date || '';
    const lineWorkflowItems = line.workflow_items || [];

    const isOptionReceived = (optionId: number): boolean =>
      lineWorkflowItems
        .filter((wi: any) => wi.option_id === optionId)
        .some((wi: any) => wi.procurement_status === 60);

    const sizeField = line.fields?.find((f: any) => f.field_name?.toLowerCase() === 'size');

    if (sizeField?.options?.length > 0) {
      for (const opt of sizeField.options) {
        if (opt.qty > 0) {
          const received = isOptionReceived(opt.option_id);
          const key = `${baseDesc}|${color}|${received}|${processedDate}`;
          if (!groups.has(key)) {
            groups.set(key, {
              baseDesc,
              color,
              isReceived: received,
              processedDate,
              sizes: [],
              totalQty: 0,
              rawId: line.id,
            });
          }
          const entry = groups.get(key)!;
          entry.sizes.push(`${opt.code || opt.name} x ${opt.qty}`);
          entry.totalQty += opt.qty;
        }
      }
    } else {
      const received = lineWorkflowItems.some((wi: any) => wi.procurement_status === 60);
      const key = `${baseDesc}|${color}|${received}|${processedDate}`;
      if (!groups.has(key)) {
        groups.set(key, {
          baseDesc,
          color,
          isReceived: received,
          processedDate,
          sizes: [],
          totalQty: 0,
          rawId: line.id,
        });
      }
      groups.get(key)!.totalQty += line.qty || 0;
    }
  }

  const items: LabelPrinterLineItem[] = Array.from(groups.entries()).map(([key, group]) => {
    let description = [group.baseDesc, group.color].filter(Boolean).join(' - ');
    if (group.sizes.length > 0) description += ` - ${group.sizes.join(', ')}`;
    else description += ` x ${group.totalQty}`;

    return {
      id: `${group.rawId}-${key}`,
      description,
      quantity: group.totalQty,
      isReceived: group.isReceived,
      receivedDate: group.processedDate || undefined,
    };
  });

  return {
    jobNumber: order.order_id?.toString() || '000000',
    customerName,
    jobName: order.job_name || `Order ${order.order_id}`,
    dateScheduled: order.date_scheduled,
    items,
  };
}

export async function fetchOrderByQuery(
  domain: string,
  username: string,
  password: string,
  query: string,
): Promise<any | null> {
  const id = String(query).trim();
  const strategies = [
    { field: '3', condition: '1', label: 'Line ID' },
    { field: '1', condition: '1', label: 'Order ID exact' },
    { field: '2', condition: '1', label: 'PO number' },
    { field: '7', condition: '1', label: 'External ref' },
  ];

  for (const strat of strategies) {
    try {
      const qp = new URLSearchParams({
        username,
        password,
        field: strat.field,
        condition: strat.condition,
        string: id,
        limit: '5',
        include_workflow_data: '1',
        include_po_data: '1',
        include_shipments: '1',
        include_production_file_info: '1',
        skip_login_token: '1',
      });
      const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
      const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(12000) });
      const text = await resp.text();
      if (!resp.ok || text.startsWith('<')) continue;

      const data = JSON.parse(text);
      if (data.response_status?.severity === 'ERROR' && (data.total || 0) === 0) continue;

      const orders = data.orders || [];
      if (orders.length === 0) continue;

      const match = orders.find((o: any) =>
        String(o.order_id) === id
        || String(o.order_number) === id
        || String(o.id) === id,
      ) || orders[0];

      return match;
    } catch {
      // try next strategy
    }
  }

  return null;
}

export function labelPrinterCorsAllowed(origin: string): boolean {
  const allowed = new Set([
    'https://stashoverview.co.uk',
    'https://www.stashoverview.co.uk',
    'http://localhost:3000',
    'http://localhost:5173',
  ]);
  return (
    allowed.has(origin)
    || (origin.endsWith('.vercel.app') && origin.includes('stash'))
    || origin.includes('aistudio.google.com')
    || origin.includes('ai.studio')
    || origin.endsWith('.googleusercontent.com')
  );
}
