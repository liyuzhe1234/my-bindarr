(function () {
  const ID = 'bindarr-efficiency-tools-link';
  function addLink() {
    if (document.getElementById(ID)) return;
    const nav = document.querySelector('nav, .nav, .top-nav, header, .app-header') || document.body;
    const a = document.createElement('a');
    a.id = ID;
    a.href = '/efficiency-tools.html';
    a.textContent = '⚡ 高效录入';
    a.style.cssText = [
      'position:fixed',
      'right:18px',
      'bottom:82px',
      'z-index:9999',
      'background:#ef4444',
      'color:white',
      'font-weight:800',
      'padding:10px 14px',
      'border-radius:999px',
      'box-shadow:0 10px 24px rgba(0,0,0,.35)',
      'text-decoration:none'
    ].join(';');
    nav.appendChild(a);
  }
  window.addEventListener('DOMContentLoaded', addLink);
  new MutationObserver(addLink).observe(document.documentElement, { childList: true, subtree: true });
})();
