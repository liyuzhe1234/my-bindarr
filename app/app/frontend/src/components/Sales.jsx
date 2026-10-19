import { useEffect, useMemo, useState } from 'react';
import { Download, Pencil, RotateCcw, Search } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import CardImage from './CardImage';
import SaleModal from './SaleModal';

const cash = n => `¥${Number(n || 0).toFixed(2)}`;

export default function Sales({ showToast, onUpdate }) {
  const [sales, setSales] = useState([]); const [summary, setSummary] = useState({});
  const [filters, setFilters] = useState({ q: '', from: '', to: '', status: 'active' });
  const [page, setPage] = useState(1); const [total, setTotal] = useState(0);
  const [modal, setModal] = useState(null); const [search, setSearch] = useState(''); const [matches, setMatches] = useState([]);
  const query = useMemo(() => new URLSearchParams({ ...filters, page, limit: 25 }).toString(), [filters, page]);
  const reload = async () => {
    const [a, b] = await Promise.all([fetch(`/api/sales?${query}`), fetch('/api/sales-summary')]);
    if (a.ok) { setSales(await a.json()); setTotal(Number(a.headers.get('X-Total-Count') || 0)); }
    if (b.ok) setSummary(await b.json());
  };
  useEffect(() => { reload(); }, [query]);
  const setFilter = (key, value) => { setPage(1); setFilters(f => ({ ...f, [key]: value })); };
  const find = async e => { e.preventDefault(); const r = await fetch(`/api/sales/inventory/search?q=${encodeURIComponent(search)}`); if (r.ok) setMatches(await r.json()); };
  const voidSale = async sale => {
    if (!window.confirm(`撤销 ${sale.printed_name || sale.name} 的售出记录并恢复库存？`)) return;
    const r = await fetch(`/api/sales/${sale.id}/void`, { method: 'POST' }); const data = await r.json().catch(() => ({}));
    if (!r.ok) return showToast?.(data.error || '撤销失败');
    showToast?.(data.placement_fallback ? '已撤销；部分卡因原位置不可用而恢复为未分配' : '已撤销并恢复库存'); reload(); onUpdate?.();
  };
  const exportCsv = async () => { const q = new URLSearchParams(filters).toString(); const r = await fetch(`/api/sales-export.csv?${q}`); if (!r.ok) return showToast?.('导出失败'); const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bindarr-sales-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(a.href); };
  const saved = () => { setModal(null); setMatches([]); reload(); onUpdate?.(); };
  return <div className="sales-page">
    <div className="page-header"><div><h1>售出记录</h1><p>记录实体卡销售、收入与已实现利润</p></div><button className="btn btn-secondary" onClick={exportCsv}><Download size={16}/> 导出当前筛选 CSV</button></div>
    <div className="sales-kpis"><div><small>售出张数</small><strong>{summary.cards_sold || 0}</strong></div><div><small>成交总额</small><strong>{cash(summary.gross_total)}</strong></div><div><small>净收入</small><strong>{cash(summary.net_revenue)}</strong></div><div><small>已实现利润</small><strong>{cash(summary.realized_profit)}</strong></div></div>
    <div className="sales-panel"><h3>销售趋势</h3><div style={{height:220}}><ResponsiveContainer><AreaChart data={summary.trend || []}><XAxis dataKey="day"/><YAxis/><Tooltip formatter={v => cash(v)}/><Area type="monotone" dataKey="net_revenue" stroke="#22c55e" fill="rgba(34,197,94,.18)"/></AreaChart></ResponsiveContainer></div></div>
    <div className="sales-panel"><h3>从 Collection 发起售出</h3><form className="sales-search" onSubmit={find}><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索卡名、系列或编号"/><button className="btn btn-primary"><Search size={16}/> 搜索库存</button></form>{matches.length > 0 && <div className="sales-search-results">{matches.map(m => <button key={`${m.entry_id}`} onClick={() => setModal({ entryId: m.entry_id })}><CardImage card={m}/><span><b>{m.printed_name || m.name}</b><small>{m.set_name} · #{m.number} · 可见库存 {m.quantity}</small></span></button>)}</div>}</div>
    <div className="sales-panel">
      <div className="sales-filters"><input placeholder="卡名/系列/编号" value={filters.q} onChange={e => setFilter('q', e.target.value)}/><input type="date" value={filters.from} onChange={e => setFilter('from', e.target.value)}/><input type="date" value={filters.to} onChange={e => setFilter('to', e.target.value)}/><select value={filters.status} onChange={e => setFilter('status', e.target.value)}><option value="active">有效</option><option value="voided">已撤销</option><option value="">全部</option></select></div>
      <div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>卡牌</th><th>数量</th><th>单价 / 成交额</th><th>费用</th><th>成本</th><th>净收入 / 利润</th><th>日期</th><th>操作</th></tr></thead><tbody>{sales.map(s => <tr key={s.id} className={s.status === 'voided' ? 'voided' : ''}><td><div className="sales-card-cell"><CardImage card={s}/><span><b>{s.printed_name || s.name}</b><small>{s.set_name} · #{s.number}</small>{s.status === 'voided' && <em>已撤销</em>}</span></div></td><td>{s.quantity}</td><td>{cash(s.unit_price)}<small>{cash(s.gross_total)}</small></td><td>手续费 {cash(s.platform_fee)}<small>运费 {cash(s.shipping_cost)}</small></td><td>{cash(s.purchase_cost)}</td><td>{cash(s.net_revenue)}<small className={s.realized_profit < 0 ? 'negative' : 'positive'}>{cash(s.realized_profit)}</small></td><td>{new Date(s.sold_at).toLocaleDateString('zh-CN')}</td><td>{s.status === 'active' && <div className="sales-actions"><button onClick={() => setModal({ saleId: s.id })} title="编辑"><Pencil size={15}/></button><button onClick={() => voidSale(s)} title="撤销"><RotateCcw size={15}/></button></div>}</td></tr>)}</tbody></table>{!sales.length && <div className="sales-empty">没有符合条件的售出记录</div>}</div>
      {total > 25 && <div className="pagination"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page} 页</span><button disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)}>下一页</button></div>}
    </div>
    {modal && <SaleModal {...modal} onClose={() => setModal(null)} onSaved={saved} showToast={showToast}/>} 
  </div>;
}
