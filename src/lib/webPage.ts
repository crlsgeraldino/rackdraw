/**
 * File → Export → Web page (Visio's "Save as Web Page"): one self-contained .html file with every page as a vector
 * picture, page tabs, zoom, device details on hover / click, and search across pages. Opens in any browser.
 */

export interface WebHotspot {
  /** Box on the picture, as fractions (0–1) of its width and height. */
  x: number; y: number; w: number; h: number;
  title: string;
  /** Shown on hover. */
  summary: string;
  /** Shown when clicked: label / value pairs. */
  rows: [string, string][];
  /** Web links (already resolved to http(s) / mailto). */
  links: { label: string; url: string }[];
}

export interface WebPage {
  name: string;
  /** The page as an SVG (or PNG) data URL. */
  image: string;
  width: number;
  height: number;
  hotspots: WebHotspot[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The viewer: plain JavaScript (no build step), reading the pages from the embedded JSON. */
const VIEWER = String.raw`
(function () {
  var data = JSON.parse(document.getElementById('nc-data').textContent);
  var pages = data.pages, cur = 0, zoom = 1;
  var tabs = document.getElementById('tabs'), stage = document.getElementById('stage'), wrap = document.getElementById('wrap');
  var img = document.getElementById('img'), spots = document.getElementById('spots'), tip = document.getElementById('tip');
  var panel = document.getElementById('panel'), search = document.getElementById('search'), results = document.getElementById('results');
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fit() {
    var p = pages[cur];
    var k = Math.min((stage.clientWidth - 24) / p.width, (stage.clientHeight - 24) / p.height);
    zoom = Math.max(0.1, Math.min(k, 2)); apply();
  }
  function apply() {
    var p = pages[cur];
    wrap.style.width = (p.width * zoom) + 'px'; wrap.style.height = (p.height * zoom) + 'px';
    document.getElementById('pct').textContent = Math.round(zoom * 100) + '%';
  }
  function show(i, focus) {
    cur = i; var p = pages[i];
    [].forEach.call(tabs.children, function (t, k) { t.classList.toggle('on', k === i); });
    img.src = p.image; spots.innerHTML = ''; panel.classList.remove('open');
    p.hotspots.forEach(function (h, k) {
      var s = el('div', 'spot'); s.style.left = (h.x * 100) + '%'; s.style.top = (h.y * 100) + '%'; s.style.width = (h.w * 100) + '%'; s.style.height = (h.h * 100) + '%';
      s.onmouseenter = function (e) { tip.textContent = h.title + (h.summary ? ' — ' + h.summary : ''); tip.style.display = 'block'; };
      s.onmousemove = function (e) { tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; };
      s.onmouseleave = function () { tip.style.display = 'none'; };
      s.onclick = function () { details(h, s); };
      s.dataset.k = k; spots.appendChild(s);
    });
    fit();
    if (focus != null) setTimeout(function () { var s = spots.children[focus]; if (s) { s.scrollIntoView({ block: 'center', inline: 'center' }); details(p.hotspots[focus], s); } }, 50);
  }
  function details(h, s) {
    [].forEach.call(spots.children, function (x) { x.classList.remove('sel'); }); s.classList.add('sel');
    panel.innerHTML = ''; panel.appendChild(el('h2', '', h.title));
    var t = el('table');
    h.rows.forEach(function (r) { var tr = el('tr'); tr.appendChild(el('th', '', r[0])); tr.appendChild(el('td', '', r[1])); t.appendChild(tr); });
    panel.appendChild(t);
    h.links.forEach(function (l) { var a = el('a', 'lnk', l.label); a.href = l.url; a.target = '_blank'; a.rel = 'noopener'; panel.appendChild(a); });
    var c = el('button', 'close', '×'); c.onclick = function () { panel.classList.remove('open'); s.classList.remove('sel'); }; panel.appendChild(c);
    panel.classList.add('open');
  }
  pages.forEach(function (p, i) { var t = el('button', 'tab', p.name); t.onclick = function () { show(i); }; tabs.appendChild(t); });
  document.getElementById('zin').onclick = function () { zoom = Math.min(4, zoom * 1.25); apply(); };
  document.getElementById('zout').onclick = function () { zoom = Math.max(0.1, zoom / 1.25); apply(); };
  document.getElementById('zfit').onclick = fit;
  window.addEventListener('resize', fit);
  search.oninput = function () {
    var q = search.value.trim().toLowerCase(); results.innerHTML = '';
    if (!q) { results.style.display = 'none'; return; }
    var n = 0;
    pages.forEach(function (p, i) { p.hotspots.forEach(function (h, k) {
      if (n >= 30) return;
      var hay = (h.title + ' ' + h.rows.map(function (r) { return r[1]; }).join(' ')).toLowerCase();
      if (hay.indexOf(q) < 0) return;
      n++; var b = el('button', 'hit'); b.appendChild(el('b', '', h.title)); b.appendChild(el('span', '', p.name + (h.summary ? ' · ' + h.summary : '')));
      b.onclick = function () { results.style.display = 'none'; show(i, k); }; results.appendChild(b);
    }); });
    if (!n) results.appendChild(el('div', 'none', 'Nothing found'));
    results.style.display = 'block';
  };
  show(0);
})();
`;

/** The whole web page. */
export function buildWebPage(client: { name: string; site?: string; date: string }, pages: WebPage[]): string {
  // JSON inside a <script> tag: keep "</script>" and the like from ending it early.
  const json = JSON.stringify({ pages }).replace(/</g, '\\u003c');
  const sub = [client.site, client.date].filter(Boolean).map((s) => esc(s!)).join(' &middot; ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(client.name)} — network diagram</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:'Segoe UI',Arial,sans-serif;color:#111827;background:#e5e7eb}
header{display:flex;align-items:center;gap:12px;padding:8px 14px;background:#1e3a8a;color:#fff}
header h1{font-size:16px;margin:0}header .sub{font-size:12px;opacity:.8}
.sp{flex:1}#search{width:260px;max-width:40vw;padding:5px 8px;border-radius:4px;border:0;font:inherit;font-size:13px}
#results{display:none;position:absolute;right:14px;top:44px;width:320px;max-height:60vh;overflow:auto;background:#fff;color:#111827;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:30}
.hit{display:block;width:100%;text-align:left;border:0;background:none;padding:6px 10px;cursor:pointer;font:inherit;font-size:13px}.hit:hover{background:#eff6ff}
.hit span{display:block;font-size:11px;color:#6b7280}.none{padding:8px 10px;font-size:12px;color:#6b7280}
#tabs{display:flex;gap:2px;padding:4px 10px 0;background:#d1d5db;overflow-x:auto}
.tab{border:0;padding:6px 12px;border-radius:6px 6px 0 0;background:#e5e7eb;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap}.tab.on{background:#fff;font-weight:600}
#bar{display:flex;gap:6px;align-items:center;padding:4px 10px;background:#fff;border-bottom:1px solid #d1d5db;font-size:12px}
#bar button{border:1px solid #d1d5db;background:#fff;border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit}
#stage{position:absolute;inset:118px 0 0 0;overflow:auto;padding:12px}
#wrap{position:relative;margin:0 auto;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.2)}
#img{position:absolute;inset:0;width:100%;height:100%}#spots{position:absolute;inset:0}
.spot{position:absolute;cursor:pointer;border-radius:3px}.spot:hover{outline:2px solid #3b82f6;background:rgba(59,130,246,.08)}
.spot.sel{outline:3px solid #f59e0b;background:rgba(245,158,11,.12)}
#tip{display:none;position:fixed;z-index:40;background:#111827;color:#fff;font-size:12px;padding:4px 8px;border-radius:4px;pointer-events:none;max-width:320px}
#panel{position:fixed;right:-360px;top:118px;bottom:0;width:340px;background:#fff;box-shadow:-4px 0 16px rgba(0,0,0,.15);padding:14px;overflow:auto;transition:right .15s;z-index:20}
#panel.open{right:0}#panel h2{font-size:16px;margin:0 24px 10px 0}#panel table{border-collapse:collapse;width:100%;font-size:12.5px}
#panel th{text-align:left;color:#6b7280;font-weight:500;padding:3px 8px 3px 0;vertical-align:top;white-space:nowrap}#panel td{padding:3px 0;word-break:break-word}
#panel .lnk{display:block;margin-top:8px;color:#1d4ed8;font-size:13px}.close{position:absolute;right:10px;top:8px;border:0;background:none;font-size:20px;cursor:pointer;color:#6b7280}
footer{position:fixed;left:10px;bottom:6px;font-size:10px;color:#6b7280}
</style></head><body>
<header><div><h1>${esc(client.name)}</h1><div class="sub">${sub}</div></div><div class="sp"></div><input id="search" placeholder="Find a device: name, IP, MAC, serial…" autocomplete="off"><div id="results"></div></header>
<nav id="tabs"></nav>
<div id="bar"><button id="zout" title="Zoom out">−</button><span id="pct">100%</span><button id="zin" title="Zoom in">+</button><button id="zfit">Fit</button><span style="color:#6b7280;margin-left:8px">Point at a device for its details, click it for everything.</span></div>
<main id="stage"><div id="wrap"><img id="img" alt=""><div id="spots"></div></div></main>
<div id="tip"></div><aside id="panel"></aside>
<footer>Made with RackDraw</footer>
<script id="nc-data" type="application/json">${json}</script>
<script>${VIEWER}</script>
</body></html>`;
}
