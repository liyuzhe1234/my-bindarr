(() => {
  const ID = 'bindarr-deck-image-import-link';
  const SINGLE_ID = 'bindarr-single-card-import-link';
  function update() {
    let link = document.getElementById(ID);
    let single = document.getElementById(SINGLE_ID);
    // Bindarr's navigation is state-based and keeps the URL at `/`, so pathname
    // cannot tell us whether Deck Builder is active. Show this authenticated
    // shortcut throughout the app; it is small and returns to the normal UI.
    const show = Boolean(localStorage.getItem('bindarr_token'));
    if (!show) { link?.remove(); single?.remove(); return; }
    if (!single) {
      single = document.createElement('a');
      single.id = SINGLE_ID;
      single.href = '/single-card-import.html';
      single.textContent = '▣ 上传一张卡牌图片';
      single.title = '从本地图片识别一张卡并加入 Collection';
      Object.assign(single.style, {
        position: 'fixed', right: '22px', bottom: '76px', zIndex: '9999',
        padding: '12px 17px', borderRadius: '12px', color: '#fff',
        background: '#24314b', boxShadow: '0 9px 28px #0007',
        textDecoration: 'none', fontWeight: '750', fontFamily: 'system-ui,sans-serif',
      });
      document.body.appendChild(single);
    }
    if (link) return;
    link = document.createElement('a');
    link.id = ID;
    link.href = '/deck-image-import.html';
    link.textContent = '▧ 从图片批量识别卡牌';
    link.title = '识别卡组图片，创建卡组或批量加入 Collection';
    Object.assign(link.style, {
      position: 'fixed', right: '22px', bottom: '22px', zIndex: '9999',
      padding: '12px 17px', borderRadius: '12px', color: '#fff',
      background: '#ff5358', boxShadow: '0 9px 28px #ff535855',
      textDecoration: 'none', fontWeight: '750', fontFamily: 'system-ui,sans-serif',
    });
    document.body.appendChild(link);
  }
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function (...args) { const value = original.apply(this, args); queueMicrotask(update); return value; };
  }
  addEventListener('popstate', update);
  addEventListener('DOMContentLoaded', update);
  new MutationObserver(update).observe(document.documentElement, { childList: true, subtree: true });
  update();
})();
