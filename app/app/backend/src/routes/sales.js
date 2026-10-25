const express = require('express');
const db = require('../db');
const { checkedOutAllocation, resolveCompartmentAndPosition } = require('../utils/collectionHelpers');

const router = express.Router();

function money(value, field) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) {
    const error = new Error(`${field} must be a number of 0 or more`);
    error.status = 400;
    throw error;
  }
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function soldAt(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    const error = new Error('sold_at must be a valid date');
    error.status = 400;
    throw error;
  }
  return date.toISOString();
}

function ids(value, field) {
  if (!Array.isArray(value)) {
    const error = new Error(`${field} must be an array`);
    error.status = 400;
    throw error;
  }
  const clean = [...new Set(value.map(Number).filter(Number.isInteger))];
  if (clean.length !== value.length) {
    const error = new Error(`${field} contains an invalid or duplicate id`);
    error.status = 400;
    throw error;
  }
  return clean;
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

async function saleRows(userId, query = {}, paginate = true) {
  const where = ['s.user_id = ?'];
  const params = [userId];
  if (query.status && ['active', 'voided'].includes(query.status)) {
    where.push('s.status = ?'); params.push(query.status);
  }
  if (query.from) { where.push('date(s.sold_at) >= date(?)'); params.push(query.from); }
  if (query.to) { where.push('date(s.sold_at) <= date(?)'); params.push(query.to); }
  if (query.q) {
    where.push('(cc.name LIKE ? OR cc.printed_name LIKE ? OR cc.set_name LIKE ? OR cc.number LIKE ?)');
    const q = `%${String(query.q).trim()}%`;
    params.push(q, q, q, q);
  }
  let limitSql = '';
  if (paginate) {
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    limitSql = ' LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);
  }
  return db.all(`
    SELECT s.*, cc.name, cc.printed_name, cc.set_name, cc.number, cc.image_url,
           COUNT(si.id) AS quantity,
           COALESCE(SUM(si.purchase_cost), 0) AS purchase_cost,
           (s.unit_price * COUNT(si.id)) AS gross_total,
           (s.unit_price * COUNT(si.id) - s.platform_fee - s.shipping_cost) AS net_revenue,
           (s.unit_price * COUNT(si.id) - s.platform_fee - s.shipping_cost - COALESCE(SUM(si.purchase_cost), 0)) AS realized_profit
    FROM sales s
    JOIN sale_items si ON si.sale_id = s.id
    JOIN card_cache cc ON cc.id = s.card_id
    WHERE ${where.join(' AND ')}
    GROUP BY s.id
    ORDER BY s.sold_at DESC, s.id DESC${limitSql}
  `, params);
}

async function inventoryRows(userId, entryId) {
  const anchor = await db.get(`SELECT * FROM collection WHERE id = ? AND user_id = ? AND list_type = 'collection'`, [entryId, userId]);
  if (!anchor) return null;
  const rows = await db.all(`
    SELECT c.id AS entry_id, c.card_id, c.quantity, c.condition, c.printing, c.language,
           c.purchase_price, c.location_id, c.compartment_id, c.position, c.added_at,
           c.grader, c.grade, c.cert_number, c.market_value,
           l.name AS location_name, cp.label AS compartment_label, cp.idx AS compartment_idx,
           cc.name, cc.printed_name, cc.set_name, cc.number, cc.image_url
    FROM collection c
    JOIN card_cache cc ON cc.id = c.card_id
    LEFT JOIN locations l ON l.id = c.location_id
    LEFT JOIN compartments cp ON cp.id = c.compartment_id
    WHERE c.user_id = ? AND c.list_type = 'collection' AND c.card_id = ?
      AND c.condition = ? AND c.printing = ? AND c.language = ?
    ORDER BY (c.location_id IS NULL) ASC, l.name, cp.idx, c.position, c.id
  `, [userId, anchor.card_id, anchor.condition, anchor.printing, anchor.language]);
  const allocated = await checkedOutAllocation(userId);
  return rows.map(row => ({
    ...row,
    checked_out: (allocated.get(row.entry_id) || 0) > 0,
    available: row.quantity === 1 && (allocated.get(row.entry_id) || 0) === 0
  }));
}

async function inventoryRowsForSale(userId, saleId) {
  const sale = await db.get(`SELECT * FROM sales WHERE id = ? AND user_id = ?`, [saleId, userId]);
  if (!sale) return null;
  const sample = await db.get(`SELECT snapshot_json FROM sale_items WHERE sale_id = ? ORDER BY id LIMIT 1`, [saleId]);
  if (!sample) return [];
  const snap = JSON.parse(sample.snapshot_json);
  const rows = await db.all(`
    SELECT c.id AS entry_id, c.card_id, c.quantity, c.condition, c.printing, c.language,
           c.purchase_price, c.location_id, c.compartment_id, c.position, c.added_at,
           c.grader, c.grade, c.cert_number, c.market_value,
           l.name AS location_name, cp.label AS compartment_label, cp.idx AS compartment_idx,
           cc.name, cc.printed_name, cc.set_name, cc.number, cc.image_url
    FROM collection c
    JOIN card_cache cc ON cc.id = c.card_id
    LEFT JOIN locations l ON l.id = c.location_id
    LEFT JOIN compartments cp ON cp.id = c.compartment_id
    WHERE c.user_id = ? AND c.list_type = 'collection' AND c.card_id = ?
      AND c.condition = ? AND c.printing = ? AND c.language = ?
    ORDER BY (c.location_id IS NULL) ASC, l.name, cp.idx, c.position, c.id
  `, [userId, sale.card_id, snap.condition, snap.printing, snap.language]);
  const allocated = await checkedOutAllocation(userId);
  return rows.map(row => ({ ...row, checked_out: (allocated.get(row.entry_id) || 0) > 0,
    available: row.quantity === 1 && (allocated.get(row.entry_id) || 0) === 0 }));
}

async function takeEntries(userId, entryIds, expectedCardId) {
  if (!entryIds.length) return [];
  const rows = await db.all(`SELECT * FROM collection WHERE user_id = ? AND list_type = 'collection' AND id IN (${placeholders(entryIds)})`, [userId, ...entryIds]);
  if (rows.length !== entryIds.length) {
    const error = new Error('One or more selected cards are no longer in your Collection'); error.status = 409; throw error;
  }
  if (rows.some(row => row.quantity !== 1)) {
    const error = new Error('Legacy stacked inventory must be normalized before selling'); error.status = 409; throw error;
  }
  const cardId = expectedCardId || rows[0].card_id;
  if (rows.some(row => row.card_id !== cardId)) {
    const error = new Error('A sale can contain only one card printing'); error.status = 400; throw error;
  }
  const allocated = await checkedOutAllocation(userId);
  if (rows.some(row => (allocated.get(row.id) || 0) > 0)) {
    const error = new Error('A selected copy is currently checked out in a deck'); error.status = 409; throw error;
  }
  return rows;
}

async function addItems(saleId, rows) {
  for (const row of rows) {
    await db.run(`INSERT INTO sale_items (sale_id, card_id, original_entry_id, purchase_cost, snapshot_json) VALUES (?, ?, ?, ?, ?)`,
      [saleId, row.card_id, row.id, Number(row.purchase_price || 0), JSON.stringify(row)]);
    await db.run(`DELETE FROM collection WHERE id = ? AND user_id = ?`, [row.id, row.user_id]);
  }
}

async function restoreItem(item, userId) {
  const snap = JSON.parse(item.snapshot_json);
  let locationId = snap.location_id;
  let compartmentId = snap.compartment_id;
  let position = snap.position || 0;
  let placementFallback = false;
  if (locationId && compartmentId) {
    try {
      const occupied = await db.get(`SELECT id FROM collection WHERE user_id = ? AND compartment_id = ? AND position = ? LIMIT 1`, [userId, compartmentId, position]);
      if (occupied) throw new Error('POSITION_OCCUPIED');
      const resolved = await resolveCompartmentAndPosition({
        locationId, compartmentId, position, userId,
        cardId: snap.card_id, printing: snap.printing, language: snap.language
      });
      if (!resolved?.compartment_id) throw new Error('LOCATION_UNAVAILABLE');
    } catch {
      locationId = null; compartmentId = null; position = 0; placementFallback = true;
    }
  }
  const values = [
    snap.id, snap.card_id, 1, snap.condition, snap.printing, snap.language,
    snap.purchase_price, locationId, compartmentId, position, snap.favorite || 0,
    snap.is_trade || 0, snap.list_type || 'collection', snap.folder || '', snap.game || 'pokemon',
    snap.added_at, userId, snap.notes || '', snap.grader || 'Raw', snap.grade,
    snap.cert_number, snap.market_value, snap.market_value_source, snap.market_value_at
  ];
  try {
    await db.run(`INSERT INTO collection (
      id, card_id, quantity, condition, printing, language, purchase_price,
      location_id, compartment_id, position, favorite, is_trade, list_type, folder, game,
      added_at, user_id, notes, grader, grade, cert_number, market_value,
      market_value_source, market_value_at
    ) VALUES (${values.map(() => '?').join(',')})`, values);
  } catch (error) {
    if (!String(error.message).includes('UNIQUE constraint failed: collection.id')) throw error;
    values.shift();
    await db.run(`INSERT INTO collection (
      card_id, quantity, condition, printing, language, purchase_price,
      location_id, compartment_id, position, favorite, is_trade, list_type, folder, game,
      added_at, user_id, notes, grader, grade, cert_number, market_value,
      market_value_source, market_value_at
    ) VALUES (${values.map(() => '?').join(',')})`, values);
  }
  return placementFallback;
}

router.get('/sales/inventory/search', async (req, res) => {
  try {
    const q = `%${String(req.query.q || '').trim()}%`;
    const rows = await db.all(`
      SELECT MIN(c.id) AS entry_id, c.card_id, c.condition, c.printing, c.language,
             COUNT(*) AS quantity, cc.name, cc.printed_name, cc.set_name, cc.number, cc.image_url
      FROM collection c JOIN card_cache cc ON cc.id = c.card_id
      WHERE c.user_id = ? AND c.list_type = 'collection'
        AND (? = '%%' OR cc.name LIKE ? OR cc.printed_name LIKE ? OR cc.set_name LIKE ? OR cc.number LIKE ?)
      GROUP BY c.card_id, c.condition, c.printing, c.language
      ORDER BY cc.name LIMIT 50`, [req.user.id, q, q, q, q, q]);
    res.json(rows);
  } catch (error) { res.status(500).json({ error: 'Failed to search sale inventory' }); }
});

router.get('/sales/inventory', async (req, res) => {
  try {
    const rows = req.query.sale_id
      ? await inventoryRowsForSale(req.user.id, Number(req.query.sale_id))
      : await inventoryRows(req.user.id, Number(req.query.entry_id));
    if (!rows) return res.status(404).json({ error: 'Collection entry not found' });
    res.json(rows);
  } catch (error) { res.status(500).json({ error: 'Failed to load sale inventory' }); }
});

router.get('/sales', async (req, res) => {
  try {
    const rows = await saleRows(req.user.id, req.query, true);
    const countRows = await saleRows(req.user.id, req.query, false);
    res.set('X-Total-Count', String(countRows.length));
    res.json(rows);
  } catch (error) { res.status(500).json({ error: 'Failed to load sales' }); }
});

router.get('/sales/:id/items', async (req, res) => {
  try {
    const sale = await db.get(`SELECT * FROM sales WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    const items = await db.all(`SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id`, [sale.id]);
    res.json({ sale, items: items.map(item => ({ ...item, snapshot: JSON.parse(item.snapshot_json) })) });
  } catch (error) { res.status(500).json({ error: 'Failed to load sale details' }); }
});

router.post('/sales', async (req, res) => {
  try {
    const entryIds = ids(req.body.entry_ids, 'entry_ids');
    if (!entryIds.length) return res.status(400).json({ error: 'Select at least one card to sell' });
    const unitPrice = money(req.body.unit_price, 'unit_price');
    const fee = money(req.body.platform_fee, 'platform_fee');
    const shipping = money(req.body.shipping_cost, 'shipping_cost');
    const date = soldAt(req.body.sold_at);
    const result = await db.withTransaction(async () => {
      const rows = await takeEntries(req.user.id, entryIds);
      const created = await db.run(`INSERT INTO sales (user_id, card_id, sold_at, unit_price, platform_fee, shipping_cost, currency) VALUES (?, ?, ?, ?, ?, ?, 'CNY')`,
        [req.user.id, rows[0].card_id, date, unitPrice, fee, shipping]);
      await addItems(created.lastID, rows);
      return { id: created.lastID, quantity: rows.length };
    });
    res.status(201).json(result);
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to record sale' }); }
});

router.put('/sales/:id', async (req, res) => {
  try {
    const keepItemIds = ids(req.body.keep_item_ids || [], 'keep_item_ids');
    const addEntryIds = ids(req.body.add_entry_ids || [], 'add_entry_ids');
    if (!keepItemIds.length && !addEntryIds.length) return res.status(400).json({ error: 'A sale must contain at least one card' });
    const result = await db.withTransaction(async () => {
      const sale = await db.get(`SELECT * FROM sales WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
      if (!sale) { const e = new Error('Sale not found'); e.status = 404; throw e; }
      if (sale.status !== 'active') { const e = new Error('A voided sale cannot be edited'); e.status = 409; throw e; }
      const current = await db.all(`SELECT * FROM sale_items WHERE sale_id = ?`, [sale.id]);
      if (keepItemIds.some(id => !current.some(item => item.id === id))) { const e = new Error('Invalid sold item selection'); e.status = 400; throw e; }
      let fallback = false;
      for (const item of current.filter(item => !keepItemIds.includes(item.id))) {
        fallback = (await restoreItem(item, req.user.id)) || fallback;
        await db.run(`DELETE FROM sale_items WHERE id = ? AND sale_id = ?`, [item.id, sale.id]);
      }
      const added = await takeEntries(req.user.id, addEntryIds, sale.card_id);
      await addItems(sale.id, added);
      await db.run(`UPDATE sales SET sold_at = ?, unit_price = ?, platform_fee = ?, shipping_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [soldAt(req.body.sold_at ?? sale.sold_at), money(req.body.unit_price ?? sale.unit_price, 'unit_price'), money(req.body.platform_fee ?? sale.platform_fee, 'platform_fee'), money(req.body.shipping_cost ?? sale.shipping_cost, 'shipping_cost'), sale.id]);
      return { placement_fallback: fallback };
    });
    res.json({ message: 'Sale updated', ...result });
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to update sale' }); }
});

router.post('/sales/:id/void', async (req, res) => {
  try {
    const result = await db.withTransaction(async () => {
      const sale = await db.get(`SELECT * FROM sales WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
      if (!sale) { const e = new Error('Sale not found'); e.status = 404; throw e; }
      if (sale.status === 'voided') { const e = new Error('Sale is already voided'); e.status = 409; throw e; }
      const items = await db.all(`SELECT * FROM sale_items WHERE sale_id = ?`, [sale.id]);
      let fallback = false;
      for (const item of items) fallback = (await restoreItem(item, req.user.id)) || fallback;
      await db.run(`UPDATE sales SET status = 'voided', voided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [sale.id]);
      return { restored: items.length, placement_fallback: fallback };
    });
    res.json(result);
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to void sale' }); }
});

router.get('/sales-summary', async (req, res) => {
  try {
    const summary = await db.get(`
      SELECT COUNT(DISTINCT s.id) AS sales_count, COUNT(si.id) AS cards_sold,
             COALESCE(SUM(s.unit_price), 0) AS gross_revenue,
             COALESCE(SUM(s.unit_price), 0) - COALESCE((SELECT SUM(platform_fee + shipping_cost) FROM sales WHERE user_id = ? AND status = 'active'), 0) AS net_revenue,
             COALESCE(SUM(s.unit_price - si.purchase_cost), 0) - COALESCE((SELECT SUM(platform_fee + shipping_cost) FROM sales WHERE user_id = ? AND status = 'active'), 0) AS realized_profit
      FROM sales s JOIN sale_items si ON si.sale_id = s.id
      WHERE s.user_id = ? AND s.status = 'active'`, [req.user.id, req.user.id, req.user.id]);
    const trend = await db.all(`
      SELECT date(s.sold_at) AS day, COUNT(si.id) AS cards_sold,
             SUM(s.unit_price) AS gross_revenue,
             SUM(s.unit_price) - SUM((s.platform_fee + s.shipping_cost) / (SELECT COUNT(*) FROM sale_items x WHERE x.sale_id = s.id)) AS net_revenue,
             SUM(s.unit_price - si.purchase_cost) - SUM((s.platform_fee + s.shipping_cost) / (SELECT COUNT(*) FROM sale_items x WHERE x.sale_id = s.id)) AS realized_profit
      FROM sales s JOIN sale_items si ON si.sale_id = s.id
      WHERE s.user_id = ? AND s.status = 'active'
      GROUP BY date(s.sold_at) ORDER BY date(s.sold_at)`, [req.user.id]);
    res.json({ ...summary, gross_total: summary.gross_revenue, trend });
  } catch (error) { res.status(500).json({ error: 'Failed to load sales summary' }); }
});

router.get('/sales-export.csv', async (req, res) => {
  try {
    const rows = await saleRows(req.user.id, req.query, false);
    const cols = ['Date','Status','Card','Set','Number','Quantity','Unit Price CNY','Gross CNY','Platform Fee CNY','Shipping CNY','Purchase Cost CNY','Net Revenue CNY','Realized Profit CNY'];
    const esc = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.map(esc).join(','), ...rows.map(row => [row.sold_at,row.status,row.printed_name || row.name,row.set_name,row.number,row.quantity,row.unit_price,row.gross_total,row.platform_fee,row.shipping_cost,row.purchase_cost,row.net_revenue,row.realized_profit].map(esc).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bindarr-sales.csv"');
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (error) { res.status(500).json({ error: 'Failed to export sales' }); }
});

module.exports = router;
