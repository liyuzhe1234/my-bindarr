const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sqlite3 = require('sqlite3');

const port = 3197;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bindarr-sales-'));
const dbPath = path.join(dir, 'test.db');
let server;
let token;

const request = async (url, options = {}) => {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers };
  return fetch(`http://127.0.0.1:${port}${url}`, { ...options, headers });
};
const sql = (statement, params = []) => new Promise((resolve, reject) => {
  const db = new sqlite3.Database(dbPath);
  db.run(statement, params, function (error) { db.close(); error ? reject(error) : resolve(this); });
});

test.before(async () => {
  server = spawn(process.execPath, ['src/server.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DB_PATH: dbPath, PORT: String(port), HTTPS_PORT: String(port + 1), NODE_ENV: 'test' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { const r = await request('/api/health'); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const bootstrap = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ password: 'test-password-123' }) });
  assert.equal(bootstrap.status, 201); token = (await bootstrap.json()).token;
  await sql(`INSERT INTO card_cache (id,name,printed_name,set_name,number,image_url) VALUES ('card-1','Test Card','测试卡','Test Set','001','')`);
  for (const cost of [10, 20, 30, 40, 50, 60]) await sql(`INSERT INTO collection (card_id,quantity,condition,printing,language,purchase_price,list_type,game,user_id) VALUES ('card-1',1,'Near Mint','Normal','Chinese (Simplified)',?,'collection','pokemon',1)`, [cost]);
});

test.after(() => { server?.kill(); });

test('create, edit and void a sale atomically with exact cost basis', async () => {
  let r = await request('/api/sales/inventory?entry_id=1'); let inventory = await r.json();
  assert.equal(inventory.length, 6);
  r = await request('/api/sales', { method: 'POST', body: JSON.stringify({ entry_ids: [1, 2, 3], unit_price: 50, platform_fee: 5, shipping_cost: 10, sold_at: '2026-10-19T12:00:00+08:00' }) });
  assert.equal(r.status, 201); const sale = await r.json();
  r = await request('/api/sales'); const rows = await r.json();
  assert.equal(rows[0].quantity, 3); assert.equal(rows[0].purchase_cost, 60); assert.equal(rows[0].net_revenue, 135); assert.equal(rows[0].realized_profit, 75);
  r = await request(`/api/sales/${sale.id}/items`); const detail = await r.json();
  r = await request(`/api/sales/${sale.id}`, { method: 'PUT', body: JSON.stringify({ keep_item_ids: detail.items.slice(0, 2).map(i => i.id), add_entry_ids: [4], unit_price: 60, platform_fee: 6, shipping_cost: 4, sold_at: '2026-10-20T12:00:00+08:00' }) });
  assert.equal(r.status, 200);
  r = await request('/api/sales-summary'); const summary = await r.json();
  assert.equal(summary.cards_sold, 3); assert.equal(summary.net_revenue, 170); assert.equal(summary.realized_profit, 100);
  r = await request(`/api/sales/${sale.id}/void`, { method: 'POST' }); assert.equal(r.status, 200);
  r = await request('/api/sales-summary'); assert.equal((await r.json()).cards_sold, 0);
  r = await request('/api/sales?status=voided'); assert.equal((await r.json()).length, 1);
});

test('checked-out copies cannot be sold', async () => {
  await sql(`INSERT INTO decks (user_id,name,checked_out) VALUES (1,'Deck',1)`);
  await sql(`INSERT INTO deck_cards (deck_id,card_id,quantity) VALUES (1,'card-1',1)`);
  let r = await request('/api/sales/inventory?entry_id=1');
  const checked = (await r.json()).find(copy => copy.checked_out);
  r = await request('/api/sales', { method: 'POST', body: JSON.stringify({ entry_ids: [checked.entry_id], unit_price: 1, platform_fee: 0, shipping_cost: 0 }) });
  assert.equal(r.status, 409);
});
