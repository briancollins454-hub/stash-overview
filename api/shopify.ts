import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'https://www.stashoverview.co.uk' || origin === 'http://localhost:3000' || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const domain = process.env.SHOPIFY_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!domain || !token) {
    return res.status(500).json({ error: 'Shopify credentials not configured on server' });
  }

  const { action, query, variables, restPath, restMethod, restBody } = req.body || {};

  // ── Inventory sub-handler ──
  if (action === 'inventory') {
    return handleInventory(req, res, domain, token);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);

    let response: globalThis.Response;

    if (action === 'rest' && restPath) {
      // REST API call (e.g. fulfillment, events)
      const url = `https://${domain}${restPath}`;
      const fetchOpts: RequestInit = {
        method: restMethod || 'GET',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      };
      if (restBody && restMethod && restMethod.toUpperCase() !== 'GET') {
        fetchOpts.body = typeof restBody === 'string' ? restBody : JSON.stringify(restBody);
      }
      response = await fetch(url, fetchOpts);
    } else {
      // GraphQL (default)
      if (!query) {
        clearTimeout(timeoutId);
        return res.status(400).json({ error: 'query is required for GraphQL calls' });
      }
      const endpoint = `https://${domain}/admin/api/2025-01/graphql.json`;
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);
    const data = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    return res.send(data);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Shopify API timeout' });
    }
    return res.status(500).json({ error: 'Shopify API failed', details: error.message });
  }
}

// ── Inventory sub-handler ──
async function handleInventory(req: VercelRequest, res: VercelResponse, domain: string, token: string) {
  const { inventoryAction, locationId, cursor, search, inventoryItemId, quantity, price, variantId } = req.body || {};
  const gqlUrl = `https://${domain}/admin/api/2025-01/graphql.json`;
  const hdrs = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' };
  async function gql(q: string, v?: any) {
    const r = await fetch(gqlUrl, { method:'POST', headers: hdrs, body: JSON.stringify({ query: q, variables: v }), signal: AbortSignal.timeout(55000) });
    return r.json();
  }

  try {
    if (inventoryAction === 'locations') {
      return res.status(200).json({ locations: [
        { id:'gid://shopify/Location/111232942466', name:'Local Stock', address:{}, isActive:true },
        { id:'gid://shopify/Location/22963719', name:'20 Church Street', address:{}, isActive:true },
      ]});
    }

    if (inventoryAction === 'inventory' && locationId) {
      // Use inventoryItems query (read_inventory scope) instead of location() (read_locations scope)
      const q = `query($first:Int!,$after:String){inventoryItems(first:$first,after:$after){pageInfo{hasNextPage endCursor}edges{node{id sku inventoryLevel(locationId:"${locationId}"){id quantities(names:["available","on_hand","committed","incoming"]){name quantity}}variant{id title price displayName barcode inventoryQuantity product{id title vendor productType featuredImage{url}}}}}}}`;
      const data = await gql(q, { first: 50, after: cursor || null });
      const root = data.data?.inventoryItems;
      if (!root) return res.status(200).json({ items: [], pageInfo: { hasNextPage: false }, error: data.errors?.[0]?.message });
      const items = (root.edges||[]).filter((e:any) => e.node.inventoryLevel).map((e:any)=>{
        const n=e.node;const lev=n.inventoryLevel;const qm:Record<string,number>={};
        (lev.quantities||[]).forEach((q:any)=>{qm[q.name]=q.quantity;});
        const v=n.variant;const p=v?.product;
        return{inventoryItemId:n.id,inventoryLevelId:lev.id,sku:n.sku||'',barcode:v?.barcode||'',variantId:v?.id,variantTitle:v?.title,displayName:v?.displayName,price:v?.price,productId:p?.id,productTitle:p?.title,vendor:p?.vendor,productType:p?.productType,imageUrl:p?.featuredImage?.url,available:qm.available??0,onHand:qm.on_hand??0,committed:qm.committed??0,incoming:qm.incoming??0};
      });
      return res.status(200).json({ items, pageInfo: root.pageInfo, locationName: locationId.includes('111232942466') ? 'Local Stock' : '20 Church Street' });
    }

    if (inventoryAction === 'search' && locationId && search) {
      const q = `query($query:String!,$first:Int!){products(first:$first,query:$query){edges{node{id title vendor productType featuredImage{url}variants(first:100){edges{node{id title price displayName barcode sku inventoryQuantity inventoryItem{id inventoryLevel(locationId:"${locationId}"){id quantities(names:["available","on_hand","committed"]){name quantity}}}}}}}}}}`;
      const data = await gql(q, { query: search, first: 20 });
      const products = (data.data?.products?.edges||[]).map((pe:any)=>{
        const p=pe.node;const variants=(p.variants?.edges||[]).map((ve:any)=>{
          const v=ve.node;const lev=v.inventoryItem?.inventoryLevel;const qm:Record<string,number>={};
          (lev?.quantities||[]).forEach((q:any)=>{qm[q.name]=q.quantity;});
          return{variantId:v.id,title:v.title,price:v.price,displayName:v.displayName,barcode:v.barcode,sku:v.sku,inventoryItemId:v.inventoryItem?.id,inventoryLevelId:lev?.id,available:qm.available??v.inventoryQuantity??0,onHand:qm.on_hand??0,committed:qm.committed??0};
        });return{productId:p.id,title:p.title,vendor:p.vendor,productType:p.productType,imageUrl:p.featuredImage?.url,variants};
      });
      return res.status(200).json({ products });
    }

    if (inventoryAction === 'adjust' && inventoryItemId && locationId && typeof quantity === 'number') {
      const data = await gql(`mutation($input:InventoryAdjustQuantitiesInput!){inventoryAdjustQuantities(input:$input){inventoryAdjustmentGroup{reason}userErrors{field message}}}`,
        {input:{reason:'correction',name:'available',changes:[{delta:quantity,inventoryItemId,locationId}]}});
      const errs=data.data?.inventoryAdjustQuantities?.userErrors||[];
      if(errs.length)return res.status(400).json({error:errs[0].message,errors:errs});
      return res.status(200).json({success:true});
    }

    if (inventoryAction === 'updatePrice' && variantId && price) {
      const data = await gql(`mutation($input:ProductVariantInput!){productVariantUpdate(input:$input){productVariant{id price}userErrors{field message}}}`,
        {input:{id:variantId,price:String(price)}});
      const errs=data.data?.productVariantUpdate?.userErrors||[];
      if(errs.length)return res.status(400).json({error:errs[0].message,errors:errs});
      return res.status(200).json({success:true,price:data.data?.productVariantUpdate?.productVariant?.price});
    }

    if (inventoryAction === 'salesVelocity' && locationId) {
      const since=new Date();since.setDate(since.getDate()-90);
      let allLi:{variantId:string;quantity:number;date:string}[]=[];let oc:string|null=null;
      for(let pg=0;pg<5;pg++){
        const data=await gql(`query($first:Int!,$after:String,$query:String!){orders(first:50,after:$after,query:$query,sortKey:CREATED_AT,reverse:true){pageInfo{hasNextPage endCursor}edges{node{createdAt lineItems(first:100){edges{node{quantity variant{id}}}}}}}}`,
          {first:50,after:oc,query:`created_at:>=${since.toISOString()}`});
        for(const oe of data.data?.orders?.edges||[]){const o=oe.node;for(const le of o.lineItems?.edges||[]){const li=le.node;if(li.variant?.id)allLi.push({variantId:li.variant.id,quantity:li.quantity,date:o.createdAt});}}
        const pi=data.data?.orders?.pageInfo;if(!pi?.hasNextPage)break;oc=pi.endCursor;
      }
      const vel:Record<string,{totalSold:number;orderCount:number;lastSold:string}>={};
      for(const it of allLi){if(!vel[it.variantId])vel[it.variantId]={totalSold:0,orderCount:0,lastSold:''};vel[it.variantId].totalSold+=it.quantity;vel[it.variantId].orderCount++;if(!vel[it.variantId].lastSold||it.date>vel[it.variantId].lastSold)vel[it.variantId].lastSold=it.date;}
      return res.status(200).json({velocity:vel,periodDays:90,totalOrders:allLi.length});
    }

    return res.status(400).json({ error: 'Invalid inventoryAction' });
  } catch (error: any) {
    if (error.name === 'AbortError') return res.status(504).json({ error: 'Timeout' });
    return res.status(500).json({ error: 'Inventory failed', details: error.message });
  }
}
