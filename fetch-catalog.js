// Run:  node fetch-catalog.js        (Node 18+)
// Downloads every collection + product (title, price, all image links, description)
// from madanstore.in, takes the image links from homesake.in, and writes catalog-data.js for index.html
const BASE = 'https://www.madanstore.in';          // products, prices, collections come from here
const IMG_BASE = 'https://www.homesake.in';        // product images are taken from here when the product exists there
const fs = require('fs');
const get = async u => {
  const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(r.status + ' ' + u);
  return r.json();
};
async function paged(path, key, base = BASE) {
  let all = [];
  for (let p = 1; ; p++) {
    const j = await get(`${base}${path}?limit=250&page=${p}`);
    const a = j[key] || [];
    all = all.concat(a);
    if (a.length < 250) break;
  }
  return all;
}
const strip = h => (h || '').replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\n{3,}/g, '\n\n').trim();

function shape(p) {
  const vs = p.variants || [];
  const best = vs.slice().sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0] || {};
  return {
    id: p.id, skus: (p.variants || []).map(v => v.sku).filter(Boolean), title: p.title, handle: p.handle, type: p.product_type || '',
    tags: p.tags || [], price: parseFloat(best.price) || 0,
    compare: parseFloat(best.compare_at_price) || 0,
    available: vs.some(v => v.available),
    images: (p.images || []).map(i => i.src),
    variants: vs.length > 1 ? vs.map(v => ({ t: v.title, p: parseFloat(v.price), c: parseFloat(v.compare_at_price) || 0, a: v.available })) : [],
    desc: strip(p.body_html), collections: []
  };
}

(async () => {
  const cols = (await paged('/collections.json', 'collections')).filter(c => c.products_count > 0);
  const map = new Map();
  for (const c of cols) {
    const ps = await paged(`/collections/${c.handle}/products.json`, 'products');
    for (const p of ps) {
      if (!map.has(p.id)) map.set(p.id, shape(p));
      map.get(p.id).collections.push(c.handle);
    }
    console.log(c.title, ps.length);
  }
  for (const p of await paged('/products.json', 'products'))
    if (!map.has(p.id)) map.set(p.id, shape(p));
  // Take image links from the main site (homesake.in): match by handle, then by SKU
  const hs = await paged('/products.json', 'products', IMG_BASE);
  const byHandle = new Map(hs.map(p => [p.handle, p]));
  const bySku = new Map();
  hs.forEach(p => (p.variants || []).forEach(v => v.sku && bySku.set(v.sku, p)));
  let matched = 0;
  for (const p of map.values()) {
    const m = byHandle.get(p.handle) || p.skus.map(k => bySku.get(k)).find(Boolean);
    if (m && m.images && m.images.length) { p.images = m.images.map(i => i.src); matched++; }
    delete p.skus;
  }
  console.log('Images taken from homesake.in for', matched, 'of', map.size, 'products');
  const data = {
    base: BASE, updated: new Date().toISOString(),
    collections: cols.map(c => ({ handle: c.handle, title: c.title, count: c.products_count })),
    products: [...map.values()]
  };
  fs.writeFileSync('catalog-data.js', 'window.CATALOG=' + JSON.stringify(data) + ';');
  console.log('Done:', data.products.length, 'products,', cols.length, 'collections');
})().catch(e => { console.error(e.message); process.exit(1); });
