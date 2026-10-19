import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import CardImage from './CardImage';
import { useBackGuard } from '../utils/useBackGuard';

const localDate = () => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
};

export default function SaleModal({ entryId, saleId, onClose, onSaved, showToast }) {
  const [copies, setCopies] = useState([]);
  const [soldItems, setSoldItems] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [unitPrice, setUnitPrice] = useState('0');
  const [fee, setFee] = useState('0');
  const [shipping, setShipping] = useState('0');
  const [date, setDate] = useState(localDate());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useBackGuard(true, onClose);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const inventoryUrl = saleId ? `/api/sales/inventory?sale_id=${saleId}` : `/api/sales/inventory?entry_id=${entryId}`;
        const requests = [fetch(inventoryUrl)];
        if (saleId) requests.push(fetch(`/api/sales/${saleId}/items`));
        const responses = await Promise.all(requests);
        if (!responses.every(r => r.ok)) throw new Error('无法加载可售库存');
        const inventory = await responses[0].json();
        if (!live) return;
        setCopies(inventory);
        if (!saleId) setSelected(new Set(inventory.filter(c => c.entry_id === Number(entryId)).map(c => c.entry_id)));
        if (saleId) {
          const detail = await responses[1].json();
          setSoldItems(detail.items);
          setSelected(new Set(detail.items.map(i => `sold-${i.id}`)));
          setUnitPrice(String(detail.sale.unit_price));
          setFee(String(detail.sale.platform_fee));
          setShipping(String(detail.sale.shipping_cost));
          setDate(String(detail.sale.sold_at).slice(0, 10));
        }
      } catch (e) { if (live) setError(e.message); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [entryId, saleId]);

  const all = useMemo(() => [
    ...soldItems.map(i => ({ ...i.snapshot, key: `sold-${i.id}`, soldItemId: i.id, purchase_price: i.purchase_cost, alreadySold: true })),
    ...copies.map(c => ({ ...c, key: c.entry_id }))
  ], [soldItems, copies]);
  const chosen = all.filter(c => selected.has(c.key));
  const qty = chosen.length;
  const gross = Number(unitPrice || 0) * qty;
  const cost = chosen.reduce((n, c) => n + Number(c.purchase_price || 0), 0);
  const net = gross - Number(fee || 0) - Number(shipping || 0);
  const profit = net - cost;

  const toggle = (copy) => {
    if (copy.checked_out || (!copy.alreadySold && !copy.available)) return;
    setSelected(prev => { const next = new Set(prev); next.has(copy.key) ? next.delete(copy.key) : next.add(copy.key); return next; });
  };

  const submit = async () => {
    if (!qty) return setError('请至少选择一张实体卡');
    setSaving(true); setError('');
    try {
      const body = { unit_price: Number(unitPrice), platform_fee: Number(fee), shipping_cost: Number(shipping), sold_at: `${date}T12:00:00+08:00` };
      if (saleId) {
        body.keep_item_ids = chosen.filter(c => c.alreadySold).map(c => c.soldItemId);
        body.add_entry_ids = chosen.filter(c => !c.alreadySold).map(c => c.entry_id);
      } else body.entry_ids = chosen.map(c => c.entry_id);
      const response = await fetch(saleId ? `/api/sales/${saleId}` : '/api/sales', {
        method: saleId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '保存售出记录失败');
      showToast?.(saleId ? '售出记录已更新' : `已记录售出 ${qty} 张卡`);
      onSaved?.(data); onClose();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return <div className="modal-overlay" style={{ zIndex: 12000 }} onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className="modal sales-modal">
      <div className="modal-header"><h2>{saleId ? '编辑售出记录' : '售出实体卡'}</h2><button className="btn btn-secondary btn-icon-only" onClick={onClose}><X size={18}/></button></div>
      {loading ? <div className="sales-empty">正在加载…</div> : <>
        {error && <div className="error-message">{error}</div>}
        <p className="field-hint">请选择本次实际卖出的每一张实体卡。套牌正在使用的卡不可出售。</p>
        <div className="sales-copy-list">{all.map(copy => {
          const blocked = copy.checked_out || (!copy.alreadySold && !copy.available);
          return <label key={copy.key} className={`sales-copy ${selected.has(copy.key) ? 'selected' : ''} ${blocked ? 'disabled' : ''}`}>
            <input type="checkbox" checked={selected.has(copy.key)} disabled={blocked} onChange={() => toggle(copy)}/>
            <CardImage card={copy} className="sales-copy-image" />
            <span><strong>{copy.printed_name || copy.name}</strong><small>{copy.set_name} · #{copy.number}</small><small>{copy.condition} · {copy.printing} · {copy.language}</small><small>成本 ¥{Number(copy.purchase_price || 0).toFixed(2)} · {copy.location_name || '未分配位置'}{copy.compartment_label ? ` / ${copy.compartment_label}` : ''}</small>{copy.checked_out && <em>正在套牌中，不能出售</em>}</span>
          </label>;
        })}</div>
        <div className="sales-form-grid">
          <label>单张成交价（人民币）<input type="number" min="0" step="0.01" value={unitPrice} onChange={e => setUnitPrice(e.target.value)}/></label>
          <label>售出日期<input type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
          <label>平台手续费<input type="number" min="0" step="0.01" value={fee} onChange={e => setFee(e.target.value)}/></label>
          <label>卖家承担运费<input type="number" min="0" step="0.01" value={shipping} onChange={e => setShipping(e.target.value)}/></label>
        </div>
        <div className="sales-calculation"><span>数量 <b>{qty}</b></span><span>成交总额 <b>¥{gross.toFixed(2)}</b></span><span>净收入 <b>¥{net.toFixed(2)}</b></span><span>成本 <b>¥{cost.toFixed(2)}</b></span><span>已实现利润 <b className={profit < 0 ? 'negative' : 'positive'}>¥{profit.toFixed(2)}</b></span></div>
        <div className="modal-actions"><button className="btn btn-secondary" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={saving || !qty} onClick={submit}>{saving ? '保存中…' : '确认保存'}</button></div>
      </>}
    </div>
  </div>;
}
