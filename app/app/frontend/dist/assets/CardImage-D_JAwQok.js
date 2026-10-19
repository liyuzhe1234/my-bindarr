import{i as e,n as t,s as n}from"./preload-helper-dtukkIW9.js";var r=n(e(),1),i=718,a=1e3,o={pokemon:{glow:`#60a5fa`,ring:`#facc15`},mtg:{glow:`#a855f7`,ring:`#cbd5e1`},lorcana:{glow:`#eab308`,ring:`#f59e0b`},default:{glow:`#ff4747`,ring:`#cbd5e1`}},s=[`#f8f6d8`,`#0e68ab`,`#2b2422`,`#d3202a`,`#00733e`];function c(e,t,n){return s.map((r,i)=>{let a=i/5*2*Math.PI-Math.PI/2;return`<circle cx="${(e+n*Math.cos(a)).toFixed(1)}" cy="${(t+n*Math.sin(a)).toFixed(1)}" r="26" fill="${r}" stroke="#0b1120" stroke-width="5"/>`}).join(``)}var l=[`#f59e0b`,`#a855f7`,`#10b981`,`#ef4444`,`#3b82f6`,`#94a3b8`];function u(e,t,n){return l.map((r,i)=>{let a=i/6*2*Math.PI-Math.PI/2;return`<circle cx="${(e+n*Math.cos(a)).toFixed(1)}" cy="${(t+n*Math.sin(a)).toFixed(1)}" r="22" fill="${r}" stroke="#0b1120" stroke-width="4"/>`}).join(``)}function d(e,t){return[-150,0,150].map(n=>`<path d="M ${e-78} ${t+n} A 78 78 0 0 1 ${e+78} ${t+n}"
        fill="none" stroke="#0b1120" stroke-width="34" stroke-linecap="round"/>
      <path d="M ${e-78} ${t+n} A 78 78 0 0 1 ${e+78} ${t+n}"
        fill="none" stroke="#e2e8f0" stroke-width="16" stroke-linecap="round" opacity="0.85"/>`).join(``)}function f(e){let t=o[e]||o.default,n=i/2,r=a/2,s=e===`mtg`,l=e===`lorcana`;return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${i} ${a}" width="${i}" height="${a}">
  <defs>
    <radialGradient id="field" cx="50%" cy="42%" r="72%">
      <stop offset="0%" stop-color="#1c2740"/>
      <stop offset="100%" stop-color="#0a0f1d"/>
    </radialGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#33405e"/>
      <stop offset="100%" stop-color="#151d31"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${t.glow}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${t.glow}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="lattice" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d="M0 0 H56 M0 0 V56" stroke="#ffffff" stroke-opacity="0.035" stroke-width="2"/>
    </pattern>
  </defs>

  <rect width="${i}" height="${a}" rx="40" fill="url(#edge)"/>
  <rect x="26" y="26" width="666" height="948" rx="22" fill="url(#field)"/>
  <rect x="26" y="26" width="666" height="948" rx="22" fill="url(#lattice)"/>
  <rect x="26" y="26" width="666" height="948" rx="22"
        fill="none" stroke="${t.ring}" stroke-opacity="0.22" stroke-width="3"/>
  <rect x="52" y="52" width="614" height="896" rx="12"
        fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="2"/>

  <circle cx="${n}" cy="${r}" r="300" fill="url(#halo)"/>
  <circle cx="${n}" cy="${r}" r="212" fill="none" stroke="${t.ring}" stroke-opacity="0.28" stroke-width="4"/>
  <circle cx="${n}" cy="${r}" r="188" fill="#0b1120" fill-opacity="0.55"/>

  ${s?c(n,r,132):l?u(n,r,132):d(n,r)}

  <text x="${n}" y="908" text-anchor="middle"
        font-family="Outfit, 'Plus Jakarta Sans', system-ui, sans-serif"
        font-size="40" font-weight="800" letter-spacing="14"
        fill="#ffffff" fill-opacity="0.22">BINDARR</text>
</svg>`}var p=e=>`data:image/svg+xml;charset=utf-8,${encodeURIComponent(e.replace(/\s+/g,` `))}`,m={pokemon:p(f(`pokemon`)),mtg:p(f(`mtg`)),lorcana:p(f(`lorcana`)),default:p(f(`default`))},h=e=>m[e]||m.default,g=e=>`/api/card-art/${encodeURIComponent(e)}.png`,_=new Set,v=!1,y=new Set,b=e=>{_=e,y.forEach(e=>e())};function x(){v||(v=!0,fetch(`/api/card-art/index`).then(e=>e.ok?e.json():null).then(e=>{Array.isArray(e?.ids)&&e.ids.length&&b(new Set(e.ids))}).catch(()=>{}))}var S=e=>(x(),y.add(e),()=>y.delete(e)),C=()=>_;function w(){return(0,r.useSyncExternalStore)(S,C,C)}function T(e,t){let n=new Set(_);t?n.add(e):n.delete(e),b(n)}var E=t();function D({card:e,src:t,alt:n,game:i,...a}){let o=w(),s=e?.card_id||e?.id||null,c=t===void 0?e?.image_url:t,l=h(i??e?.game),u=[s&&o.has(s)?g(s):null,c||null,l].filter(Boolean),[d,f]=(0,r.useState)(0),p=u.join(`|`),m=(0,r.useRef)(p);m.current!==p&&(m.current=p,d!==0&&f(0));let _=u[Math.min(d,u.length-1)],v=_===l;return(0,E.jsx)(`img`,{...a,src:_,alt:n??e?.name??``,"data-card-back":v?`true`:void 0,onError:e=>{d<u.length-1&&f(d+1),a.onError?.(e)}})}export{w as i,g as n,T as r,D as t};
//# sourceMappingURL=CardImage-D_JAwQok.js.map