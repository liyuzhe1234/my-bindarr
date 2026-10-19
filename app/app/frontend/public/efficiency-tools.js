(function () {
  const $ = (id) => document.getElementById(id);
  const status = (id, text) => { $(id).textContent = text || ''; };
  const readImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
  const img = (card) => card.image_url || (card.images && card.images.small) || '';
  const name = (card) => card.printed_name || card.name || card.card_name || 'Unknown';
  let selectedSingle = null;

  async function jsonFetch(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
    return data;
  }

  function renderCandidates(candidates) {
    const box = $('singleCandidates');
    box.innerHTML = '';
    selectedSingle = null;
    const cards = (candidates || []).filter(c => c && c.card).slice(0, 5);
    if (!cards.length) {
      box.innerHTML = '<p>没有找到候选卡。</p>';
      $('singleAdd').disabled = true;
      return;
    }
    cards.forEach((entry, idx) => {
      const card = entry.card;
      const div = document.createElement('div');
      div.className = 'candidate' + (idx === 0 ? ' selected' : '');
      div.innerHTML = `
        <img src="${img(card)}" alt="">
        <div>
          <div class="name">${name(card)}</div>
          <div class="meta">${card.set_name || ''} #${card.number || ''}</div>
          <div class="meta">score/inliers: ${entry.score ?? entry.inliers ?? '—'}</div>
        </div>`;
      div.onclick = () => {
        document.querySelectorAll('.candidate').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        selectedSingle = card;
        $('singleAdd').disabled = false;
      };
      box.appendChild(div);
      if (idx === 0) selectedSingle = card;
    });
    $('singleAdd').disabled = !selectedSingle;
  }

  async function recognizeSingle() {
    const file = $('singleFile').files[0];
    if (!file) return status('singleStatus', '请先选择一张卡图。');
    status('singleStatus', '正在识别...');
    try {
      const image = await readImage(file);
      const lang = $('singleLang').value;
      const data = await jsonFetch('/api/scan-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: 'pokemon', image, lang, cropped: false })
      });
      renderCandidates(data.candidates || (data.card ? [{ card: data.card, score: data.score }] : []));
      status('singleStatus', data.card ? `识别完成：${name(data.card)}` : '识别完成，请选择候选。');
    } catch (err) {
      status('singleStatus', `识别失败：${err.message}`);
    }
  }

  async function addSingle() {
    if (!selectedSingle) return;
    status('singleStatus', '正在加入 Collection...');
    try {
      const data = await jsonFetch('/api/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: selectedSingle.id,
          quantity: Math.max(1, parseInt($('singleQty').value, 10) || 1),
          condition: 'Near Mint',
          printing: 'Normal',
          language: $('singleLang').value,
          purchase_price: 0,
          game: 'pokemon',
          list_type: 'collection',
          stackable: true
        })
      });
      status('singleStatus', data.message || `已加入：${name(selectedSingle)}`);
    } catch (err) {
      status('singleStatus', `加入失败：${err.message}`);
    }
  }

  async function loadRecent() {
    status('recentStatus', '正在加载...');
    try {
      const rows = await jsonFetch('/api/collection/recent?limit=50');
      $('recentCards').innerHTML = rows.map(card => `
        <div class="card">
          <img src="${img(card)}" alt="">
          <div class="name">${name(card)} ×${card.quantity || 1}</div>
          <div class="meta">${card.set_name || ''} #${card.number || ''}</div>
          <div class="meta">${card.condition || ''} · ${card.location_name || '未分配'}</div>
        </div>`).join('');
      status('recentStatus', `已加载 ${rows.length} 条。`);
    } catch (err) {
      status('recentStatus', `加载失败：${err.message}`);
    }
  }

  async function loadDecks() {
    status('deckStatus', '正在加载卡组...');
    try {
      const decks = await jsonFetch('/api/decks');
      $('deckSelect').innerHTML = decks.map(d => `<option value="${d.id}">${d.name}（${d.total_cards || 0}）</option>`).join('');
      status('deckStatus', decks.length ? `已加载 ${decks.length} 个卡组。` : '还没有卡组。');
    } catch (err) {
      status('deckStatus', `加载失败：${err.message}`);
    }
  }

  async function ownDeck() {
    const id = $('deckSelect').value;
    if (!id) return status('deckStatus', '请先选择卡组。');
    if (!confirm('确认把这个卡组里的所有卡加入 Collection？')) return;
    status('deckStatus', '正在加入 Collection...');
    try {
      const data = await jsonFetch(`/api/decks/${id}/add-to-collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: $('deckLang').value, condition: 'Near Mint', printing: 'Normal' })
      });
      status('deckStatus', data.message || '已加入 Collection。');
    } catch (err) {
      status('deckStatus', `加入失败：${err.message}`);
    }
  }

  async function repairTypes() {
    status('repairStatus', '正在修复...');
    try {
      const data = await jsonFetch('/api/admin/repair-pokemon-cn-supertypes', { method: 'POST' });
      status('repairStatus', `修复完成：${data.repaired || 0} 条。刷新 Collection/Deck Builder 后生效。`);
    } catch (err) {
      status('repairStatus', `修复失败：${err.message}`);
    }
  }

  $('singleRecognize').onclick = recognizeSingle;
  $('singleAdd').onclick = addSingle;
  $('loadRecent').onclick = loadRecent;
  $('reloadDecks').onclick = loadDecks;
  $('ownDeck').onclick = ownDeck;
  $('repairTypes').onclick = repairTypes;
  loadDecks();
  loadRecent();
})();
