/* Canada's Pictorial Cancels — single-file app. Mounts into #cpc-app. */
(function () {
  'use strict';
  var script = document.currentScript;
  var BASE = (script && script.src) ? script.src.replace(/[^/]*$/, '') : './';
  var root = document.getElementById('cpc-app');
  if (!root) return;
  var NOW = new Date().getFullYear(), Y0 = 2001, Y1 = 2036, TAGSTEP = 12;
  var INK = { Black: '#1A1A1A', Red: '#D52B1E', Blue: '#1F4FBF', Green: '#1B7F4B', Pink: '#E86AA6' };
  var S = { view: 'map', q: '', act: true, exp: true, prov: '', tag: '', ink: '', ya: null, yb: null, soon: false, sort: 'place', id: '', per: 50, page: 1 };
  var D = [], byId = {}, updated = '', me = null, tagN = TAGSTEP;
  var map, cluster, markers = {}, leafletReady = false, filtered = [];
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------- helpers ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag), k;
    for (k in attrs || {}) {
      if (attrs[k] == null || attrs[k] === false) continue;
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function thumb(c) { return BASE + 'img/thumb/' + c.id + '.jpg'; }
  function full(c) { return BASE + 'img/full/' + c.id + '.jpg'; }
  function expired(c) { return c.status !== 'Active'; }
  function st(c) { return expired(c) ? 'expired' : 'active'; }
  function stName(c) { return expired(c) ? 'Expired' : 'Active'; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function title(c) { var m = /"([^"]+)"/.exec(c.design || ''); return m ? m[1] : cap((c.design || c.nick || c.po).split(';')[0]); }
  function label(c) { return c.nick ? cap(c.nick) : title(c); }
  function runShort(c) { return (c.s || '?') + '–' + (c.e || (c.open ? 'now' : '?')); }
  function dist(a, b) {
    var R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function inRange(c, a, b) {
    if (c.s && c.s > b) return false;
    if (c.e && c.e < a) return false;
    if (expired(c) && !c.e && a >= NOW) return false;
    return true;
  }
  function toast(msg) { var t = h('div', { class: 'cpc cpc-toast', role: 'status', text: msg }); document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2200); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function svg(d) {
    var NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
    [['viewBox', '0 0 24 24'], ['width', 18], ['height', 18], ['aria-hidden', 'true'], ['fill', 'none'], ['stroke', '#5A6270'], ['stroke-width', 2], ['stroke-linecap', 'round']].forEach(function (a) { s.setAttribute(a[0], a[1]); });
    p.setAttribute('d', d); s.appendChild(p); return s;
  }

  /* ---------- state <-> URL ---------- */
  function writeHash() {
    var p = new URLSearchParams();
    if (S.view !== 'map') p.set('view', S.view);
    if (S.q) p.set('q', S.q);
    if (!S.act) p.set('active', '0');
    if (!S.exp) p.set('expired', '0');
    ['prov', 'tag', 'ink', 'id'].forEach(function (k) { if (S[k]) p.set(k, S[k]); });
    if (S.ya) p.set('years', S.ya + '-' + S.yb);
    if (S.soon) p.set('soon', '1');
    if (S.sort !== 'place') p.set('sort', S.sort);
    if (S.per !== 50) p.set('per', S.per);
    if (S.page > 1) p.set('page', S.page);
    var s = p.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }
  function readHash() {
    var p = new URLSearchParams(location.hash.replace(/^#/, '')), y = /^(\d{4})-(\d{4})$/.exec(p.get('years') || '');
    S.view = p.get('view') === 'gallery' ? 'gallery' : 'map';
    S.q = p.get('q') || ''; S.act = p.get('active') !== '0'; S.exp = p.get('expired') !== '0';
    S.prov = p.get('prov') || ''; S.tag = p.get('tag') || ''; S.ink = p.get('ink') || '';
    S.ya = y ? +y[1] : null; S.yb = y ? +y[2] : null; S.soon = p.get('soon') === '1';
    S.sort = p.get('sort') || 'place'; S.id = p.get('id') || '';
    S.per = p.get('per') === 'all' ? 'all' : (parseInt(p.get('per'), 10) || 50); S.page = parseInt(p.get('page'), 10) || 1;
  }

  /* ---------- filtering ---------- */
  function match(c, skip) {
    if (expired(c) ? !S.exp : !S.act) return false;
    if (skip !== 'prov' && S.prov && c.prov !== S.prov) return false;
    if (S.ink && c.ink !== S.ink) return false;
    if (S.soon && !(c.status === 'Active' && c.e && c.e <= NOW + 1)) return false;
    if (S.ya && !inRange(c, S.ya, S.yb)) return false;
    if (skip !== 'tag' && S.tag && c._t.indexOf(S.tag) < 0) return false;
    if (S.q) { var w = S.q.toLowerCase().split(/\s+/).filter(Boolean); for (var i = 0; i < w.length; i++) if (c._s.indexOf(w[i]) < 0) return false; }
    return true;
  }
  function sortList(list) {
    if (S.sort === 'near' && me) list.forEach(function (c) { c._d = dist(me, c); });
    var f = {
      added: function (a, b) { return a.added < b.added ? 1 : a.added > b.added ? -1 : a._o - b._o; },
      oldest: function (a, b) { return (a.s || 9999) - (b.s || 9999) || a._o - b._o; },
      ending: function (a, b) { return (a.e || 9999) - (b.e || 9999) || a._o - b._o; },
      near: function (a, b) { return a._d - b._d; }
    }[S.sort];
    return f ? list.slice().sort(f) : list;
  }

  /* ---------- skeleton ---------- */
  var el = {};
  function build() {
    root.className = 'cpc' + (root.hasAttribute('data-breakout') ? ' cpc--breakout' : '');
    root.innerHTML = '';
    if (store('cpc-side')) root.style.setProperty('--side', store('cpc-side') + 'px');
    if (store('cpc-cell')) root.style.setProperty('--cell', store('cpc-cell') + 'px');
    el.search = h('input', { type: 'search', placeholder: 'Search town, post office or design', 'aria-label': 'Search', value: S.q,
      oninput: debounce(function () { S.q = el.search.value.trim(); go(true); }, 160) });
    el.tabMap = h('button', { class: 'cpc-tab', type: 'button', text: 'Map', onclick: function () { setView('map'); } });
    el.tabGal = h('button', { class: 'cpc-tab', type: 'button', text: 'Gallery', onclick: function () { setView('gallery'); } });
    var top = h('header', { class: 'cpc-top' }, [
      h('h1', { class: 'cpc-title', text: "Canada's Pictorial Cancels" }),
      h('label', { class: 'cpc-search' }, [svg('M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-3.5-3.5'), el.search]),
      h('nav', { class: 'cpc-tabs', 'aria-label': 'Views' }, [el.tabMap, el.tabGal])
    ]);
    el.count = h('span', { class: 'cpc-count', role: 'status' });
    function yr() {
      var a = +el.ya.value, b = +el.yb.value;
      if (a > b) { if (this === el.ya) el.yb.value = b = a; else el.ya.value = a = b; }
      paintYears();
      if (el.yOn.checked) { S.ya = a; S.yb = b; go(); }
    }
    el.yOn = h('input', { type: 'checkbox', onchange: function () { if (el.yOn.checked) { S.ya = +el.ya.value; S.yb = +el.yb.value; } else S.ya = S.yb = null; go(); } });
    el.ya = h('input', { type: 'range', min: Y0, max: Y1, step: 1, value: Y0, 'aria-label': 'Earliest year', oninput: yr });
    el.yb = h('input', { type: 'range', min: Y0, max: Y1, step: 1, value: NOW, 'aria-label': 'Latest year', oninput: yr });
    el.yFill = h('span', { class: 'fill' });
    el.yDual = h('div', { class: 'cpc-dual' }, [h('span', { class: 'trk' }), el.yFill, el.ya, el.yb]);
    el.yOut = h('output', { class: 'mono' });
    el.sort = h('select', { class: 'cpc-btn', 'aria-label': 'Sort', onchange: function () {
      if (el.sort.value === 'near' && !me) { el.sort.value = S.sort; return locate(); }
      S.sort = el.sort.value; go(); } },
      [['place', 'Sort: province, town'], ['added', 'Sort: newest added'], ['oldest', 'Sort: oldest first'], ['ending', 'Sort: ending soonest'], ['near', 'Sort: nearest to me']]
        .map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    var bar = h('div', { class: 'cpc-bar' }, [
      h('button', { class: 'cpc-btn cpc-filtertoggle', type: 'button', text: 'Filters', onclick: function () { el.filters.classList.toggle('open'); } }),
      el.count,
      h('div', { class: 'cpc-year' }, [h('label', {}, [el.yOn, 'In use between']), el.yOut, el.yDual]),
      el.sort,
      h('button', { class: 'cpc-btn', type: 'button', text: 'Near me', onclick: locate }),
      h('button', { class: 'cpc-btn', type: 'button', text: 'Download list', title: 'Download the cancels shown as a CSV file', onclick: csv })
    ]);
    el.fbody = h('div', { style: 'display:contents' });
    el.grip = h('button', { class: 'cpc-grip', type: 'button', 'aria-label': 'Drag to resize the filter panel', title: 'Drag to resize' });
    el.filters = h('aside', { class: 'cpc-filters', 'aria-label': 'Filters' }, [el.fbody, el.grip]);
    grip();
    el.mapWrap = h('div', {}, [
      el.map = h('div', { class: 'cpc-map', role: 'application', 'aria-label': 'Map of post offices with pictorial cancels' }),
      el.stripH = h('div', { class: 'cpc-strip-h' }), el.strip = h('div', { class: 'cpc-strip' })
    ]);
    el.tools = h('div', { class: 'cpc-tools' }); el.tools2 = h('div', { class: 'cpc-tools foot' });
    el.galWrap = h('div', {}, [el.tools, el.grid = h('div', { class: 'cpc-grid' }), el.tools2]);
    el.detail = h('aside', { class: 'cpc-detail', 'aria-label': 'Selected cancel', hidden: true });
    el.body = h('div', { class: 'cpc-body' }, [el.filters, h('main', {}, [el.mapWrap, el.galWrap]), el.detail]);
    root.appendChild(top); root.appendChild(bar); root.appendChild(el.body);
  }
  function paintYears() {
    var a = +el.ya.value, b = +el.yb.value, span = Y1 - Y0;
    el.yFill.style.left = ((a - Y0) / span * 100) + '%'; el.yFill.style.width = ((b - a) / span * 100) + '%';
    el.yOut.textContent = a === b ? String(a) : a + '–' + b;
    el.ya.style.zIndex = a > Y0 + span / 2 ? 2 : 1;
  }
  function grip() {
    var x0, w0;
    function move(e) { var w = Math.max(200, Math.min(560, w0 + e.clientX - x0)); root.style.setProperty('--side', w + 'px'); store('cpc-side', w); if (map) map.invalidateSize(); }
    function up() { el.grip.classList.remove('drag'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }
    el.grip.addEventListener('pointerdown', function (e) { e.preventDefault(); x0 = e.clientX; w0 = el.filters.getBoundingClientRect().width; el.grip.classList.add('drag');
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); });
    el.grip.addEventListener('keydown', function (e) { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var w = Math.max(200, Math.min(560, el.filters.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 20 : -20))); root.style.setProperty('--side', w + 'px'); store('cpc-side', w); });
  }

  /* ---------- filter column ---------- */
  function chip(kids, on, fn, cls) { return h('button', { class: 'cpc-chip ' + (cls || ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: fn }, kids); }
  function renderFilters() {
    var a = S.act, x = S.exp; S.act = S.exp = true;
    var base = D.filter(function (c) { return match(c); }); S.act = a; S.exp = x;
    var nA = base.filter(function (c) { return !expired(c); }).length, nE = base.length - nA;
    var f = el.fbody; f.innerHTML = '';
    f.appendChild(h('div', {}, [h('h2', { class: 'cpc-h', text: 'Status' }), h('div', { class: 'cpc-chips' }, [
      chip([h('span', { class: 'dot' }), 'Active', h('small', { text: String(nA) })], S.act, function () { S.act = !S.act; if (!S.act && !S.exp) S.exp = true; go(); }, 'st active'),
      chip([h('span', { class: 'dot expired' }), 'Expired', h('small', { text: String(nE) })], S.exp, function () { S.exp = !S.exp; if (!S.act && !S.exp) S.act = true; go(); }, 'st expired'),
      chip(['Ending by ' + (NOW + 1)], S.soon, function () { S.soon = !S.soon; go(); })
    ])]));
    var tc = {}; D.forEach(function (c) { if (match(c, 'tag')) c._t.forEach(function (t) { tc[t] = (tc[t] || 0) + 1; }); });
    var tags = Object.keys(tc).sort(function (p, q) { return tc[q] - tc[p] || p.localeCompare(q); });
    if (S.tag) tags = [S.tag].concat(tags.filter(function (t) { return t !== S.tag; }));
    var chips = tags.slice(0, tagN).map(function (t) { return chip([t, h('small', { text: String(tc[t] || 0) })], S.tag === t, function () { S.tag = S.tag === t ? '' : t; go(true); }); });
    if (tags.length > tagN) chips.push(h('button', { class: 'cpc-chip more', type: 'button', text: 'Load more (' + (tags.length - tagN) + ')', onclick: function () { tagN += TAGSTEP; renderFilters(); } }));
    else if (tagN > TAGSTEP) chips.push(h('button', { class: 'cpc-chip more', type: 'button', text: 'Show fewer', onclick: function () { tagN = TAGSTEP; renderFilters(); } }));
    f.appendChild(h('div', {}, [h('h2', { class: 'cpc-h', text: 'Theme' }), h('div', { class: 'cpc-chips' }, chips.length ? chips : [h('small', { text: 'No tags in this selection' })])]));
    f.appendChild(h('div', {}, [h('h2', { class: 'cpc-h', text: 'Ink colour' }), h('div', { class: 'cpc-chips' },
      Object.keys(INK).map(function (k) { return chip([h('span', { class: 'swatch', style: 'background:' + INK[k] }), k], S.ink === k, function () { S.ink = S.ink === k ? '' : k; go(true); }); }))]));
    var pv = {}, max = 1;
    D.forEach(function (c) { pv[c.prov] = pv[c.prov] || [0, 0]; if (match(c, 'prov')) pv[c.prov][expired(c) ? 1 : 0]++; });
    Object.keys(pv).forEach(function (k) { max = Math.max(max, pv[k][0] + pv[k][1]); });
    f.appendChild(h('div', {}, [h('h2', { class: 'cpc-h', text: 'Province or territory' })].concat(
      Object.keys(pv).sort(function (p, q) { return (pv[q][0] + pv[q][1]) - (pv[p][0] + pv[p][1]) || p.localeCompare(q); }).map(function (k) {
        return h('button', { class: 'cpc-prov', type: 'button', 'aria-pressed': S.prov === k ? 'true' : 'false', 'aria-label': k + ': ' + pv[k][0] + ' active, ' + pv[k][1] + ' expired',
          onclick: function () { S.prov = S.prov === k ? '' : k; go(true); } }, [
          h('span', { class: 'n', text: k }),
          h('span', { class: 'bar' }, [h('i', { style: 'width:' + (pv[k][0] / max * 100) + '%' }), h('i', { style: 'width:' + (pv[k][1] / max * 100) + '%' })]),
          h('span', { class: 'c mono', text: String(pv[k][0] + pv[k][1]) })
        ]);
      }))));
    if (S.q || S.prov || S.tag || S.ink || S.ya || S.soon || !S.act || !S.exp)
      f.appendChild(h('button', { class: 'cpc-clear', type: 'button', text: 'Clear all filters', onclick: function () {
        S.q = S.prov = S.tag = S.ink = ''; S.ya = S.yb = null; S.soon = false; S.act = S.exp = true; el.search.value = ''; go(true); } }));
  }
  function go(fit) { S.page = 1; update(fit); }

  /* ---------- cards, gallery ---------- */
  function card(c) {
    var isNew = updated && (new Date(updated) - new Date(c.added)) < 60 * 864e5;
    return h('button', { class: 'cpc-card ' + st(c), type: 'button', 'aria-current': S.id === c.id ? 'true' : null, onclick: function () { select(c.id); } }, [
      h('span', { class: 'imw' }, [
        h('img', { class: 'im', src: thumb(c), alt: c.design || c.po, loading: 'lazy', decoding: 'async', width: 360, height: 360 }),
        h('span', { class: 'cpc-badge ' + st(c), text: stName(c) }),
        isNew ? h('span', { class: 'cpc-new', text: 'NEW' }) : null
      ]),
      h('span', { class: 'tx' }, [
        h('span', { class: 'po', text: c.po, title: c.po }),
        h('span', { class: 'de', text: (c._d != null && S.sort === 'near' ? Math.round(c._d) + ' km · ' : '') + label(c) }),
        h('span', { class: 'r3' }, [h('span', { class: 'pv', text: c.prov }), h('span', { class: 'mono', text: runShort(c) })])
      ])
    ]);
  }
  function pages() { return S.per === 'all' ? 1 : Math.max(1, Math.ceil(filtered.length / S.per)); }
  function pager() {
    var n = pages(), p = S.page, box = h('div', { class: 'cpc-pager', role: 'navigation', 'aria-label': 'Pages' });
    if (n < 2) return box;
    function b(txt, to, cur, lab) { return h('button', { class: 'cpc-btn', type: 'button', text: txt, 'aria-label': lab || ('Page ' + txt), 'aria-current': cur ? 'true' : null, disabled: to < 1 || to > n ? '' : null,
      onclick: function () { S.page = to; renderGallery(); writeHash(); el.galWrap.scrollIntoView({ block: 'start' }); } }); }
    box.appendChild(b('‹', p - 1, false, 'Previous page'));
    var list = [1, p - 1, p, p + 1, n].filter(function (v, i, a) { return v >= 1 && v <= n && a.indexOf(v) === i; }).sort(function (x, y) { return x - y; });
    list.forEach(function (v, i) { if (i && v - list[i - 1] > 1) box.appendChild(h('span', { text: '…', 'aria-hidden': 'true' })); box.appendChild(b(String(v), v, v === p)); });
    box.appendChild(b('›', p + 1, false, 'Next page'));
    return box;
  }
  function renderGallery() {
    var total = filtered.length, n = pages(); if (S.page > n) S.page = n;
    var per = S.per === 'all' ? total : S.per, from = (S.page - 1) * per, opts = [];
    for (var v = 50; v < total; v += 50) opts.push(v);
    var sel = h('select', { 'aria-label': 'Results per page', onchange: function () { S.per = sel.value === 'all' ? 'all' : +sel.value; S.page = 1; renderGallery(); writeHash(); } },
      opts.map(function (o) { return h('option', { value: o, text: String(o) }); }).concat([h('option', { value: 'all', text: 'All' })]));
    sel.value = S.per === 'all' || S.per >= total ? 'all' : String(S.per);
    var zoom = h('input', { type: 'range', min: 110, max: 420, step: 10, value: parseInt(getComputedStyle(root).getPropertyValue('--cell'), 10) || 180, 'aria-label': 'Image size',
      oninput: function () { root.style.setProperty('--cell', zoom.value + 'px'); store('cpc-cell', zoom.value); } });
    el.tools.innerHTML = ''; el.tools2.innerHTML = ''; el.grid.innerHTML = '';
    el.tools.appendChild(h('label', {}, ['Per page', sel, 'of ' + total + (total === 1 ? ' result' : ' results')]));
    el.tools.appendChild(pager());
    el.tools.appendChild(h('label', { class: 'cpc-zoom' }, ['Image size', zoom]));
    if (!total) { el.grid.appendChild(h('div', { class: 'cpc-empty', style: 'grid-column:1/-1', text: 'No cancels match these filters.' })); return; }
    var frag = document.createDocumentFragment();
    filtered.slice(from, from + per).forEach(function (c) { frag.appendChild(card(c)); });
    el.grid.appendChild(frag);
    el.tools2.appendChild(pager());
  }

  /* ---------- map ---------- */
  function loadLeaflet(cb) {
    if (window.L && L.markerClusterGroup) return cb();
    ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css']
      .forEach(function (u) { document.head.appendChild(h('link', { rel: 'stylesheet', href: u })); });
    var s1 = h('script', { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' });
    s1.onload = function () { var s2 = h('script', { src: 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js' }); s2.onload = cb; document.head.appendChild(s2); };
    document.head.appendChild(s1);
  }
  function pin(c, sel) { return L.divIcon({ html: '<div class="cpc-pin ' + st(c) + (sel ? ' sel' : '') + '"></div>', className: '', iconSize: [16, 16], iconAnchor: [8, 8] }); }
  function tip(m, dir) { if (!m.getTooltip()) m.bindTooltip(label(byId[m.options.cpcId]), { permanent: true, direction: dir, offset: dir === 'right' ? [10, 0] : [0, 0], className: 'cpc-label' }); }
  function initMap() {
    map = L.map(el.map, { minZoom: 2, maxZoom: 16, zoomSnap: 0.25, worldCopyJump: true, scrollWheelZoom: false }).setView([58, -96], 3);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    map.on('click', function () { map.scrollWheelZoom.enable(); });
    cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 44, spiderfyOnMaxZoom: true,
      iconCreateFunction: function (cl) {
        var ms = cl.getAllChildMarkers(), n = ms.length, e = ms.filter(function (m) { return m.options.cpcExp; }).length, d = Math.round(30 + Math.sqrt(n) * 4);
        return L.divIcon({ html: '<div class="cpc-cluster' + (e > n - e ? ' expired' : '') + '" style="width:' + d + 'px;height:' + d + 'px" title="' + (n - e) + ' active, ' + e + ' expired">' + n + '</div>', className: '', iconSize: [d, d] });
      } });
    D.forEach(function (c) {
      var m = L.marker([c.lat, c.lng], { title: c.po + ' — ' + label(c), alt: c.po, icon: pin(c, false), keyboard: true, cpcExp: expired(c), cpcId: c.id });
      m.on('click', function () { select(c.id, true); }); markers[c.id] = m;
    });
    cluster.on('spiderfied', function (e) { e.markers.forEach(function (m) { m._sp = true; tip(m, 'auto'); }); });
    cluster.on('unspiderfied', function (e) { e.markers.forEach(function (m) { m._sp = false; m.unbindTooltip(); }); });
    cluster.on('animationend', labels);
    map.addLayer(cluster);
    map.on('moveend', debounce(function () { renderStrip(); labels(); }, 120));
    leafletReady = true; renderMap(true);
  }
  function labels() {
    if (!leafletReady) return;
    var b = map.getBounds(), free = [];
    filtered.forEach(function (c) { var m = markers[c.id]; if (m._sp) return;
      if (cluster.getVisibleParent(m) === m && b.contains(m.getLatLng())) free.push(m); else if (m.getTooltip()) m.unbindTooltip(); });
    var show = free.length <= 40;
    free.forEach(function (m) { if (show) tip(m, 'right'); else if (m.getTooltip()) m.unbindTooltip(); });
  }
  function renderMap(fit) {
    if (!leafletReady) return;
    cluster.clearLayers(); cluster.addLayers(filtered.map(function (c) { return markers[c.id]; }));
    if (fit && filtered.length && S.view === 'map') map.fitBounds(L.latLngBounds(filtered.map(function (c) { return [c.lat, c.lng]; })).pad(0.08), { maxZoom: 11, animate: false });
    renderStrip(); setTimeout(labels, 50);
  }
  function renderStrip() {
    if (!leafletReady || S.view !== 'map') return;
    var b = map.getBounds(), inView = filtered.filter(function (c) { return b.contains([c.lat, c.lng]); });
    el.stripH.textContent = inView.length ? inView.length + (inView.length === 1 ? ' cancel' : ' cancels') + ' in this part of the map' : 'No cancels in this part of the map. Zoom out or move the map.';
    el.strip.innerHTML = '';
    var frag = document.createDocumentFragment(); inView.slice(0, 40).forEach(function (c) { frag.appendChild(card(c)); }); el.strip.appendChild(frag);
  }

  /* ---------- detail ---------- */
  function select(id, fromMap) {
    var prev = S.id; S.id = id || '';
    if (leafletReady) { if (prev && markers[prev]) markers[prev].setIcon(pin(byId[prev], false)); if (id && markers[id]) markers[id].setIcon(pin(byId[id], true)); }
    renderDetail(); writeHash();
    root.querySelectorAll('.cpc-card[aria-current]').forEach(function (n) { n.removeAttribute('aria-current'); });
    root.querySelectorAll('.cpc-card').forEach(function (n) { if (n._id === id) n.setAttribute('aria-current', 'true'); });
    if (S.view === 'gallery') renderGallery(); else renderStrip();
    if (id && !fromMap && S.view === 'map' && leafletReady) showOnMap(id, true);
  }
  function showOnMap(id, gentle) {
    var c = byId[id]; if (!c) return;
    if (S.view !== 'map') setView('map');
    if (!leafletReady) return;
    if (gentle && map.getBounds().contains([c.lat, c.lng]) && map.getZoom() >= 6) return;
    if (cluster.hasLayer(markers[id])) cluster.zoomToShowLayer(markers[id]); else map.setView([c.lat, c.lng], 10);
    if (window.innerWidth <= 1100) el.map.scrollIntoView({ block: 'center' });
  }
  function rel(c, lab) {
    return h('button', { class: 'cpc-rel', type: 'button', onclick: function () { select(c.id); } }, [
      h('img', { src: thumb(c), alt: '', loading: 'lazy', width: 48, height: 48 }),
      h('span', {}, [label(c), h('small', { text: lab + ' · ' + stName(c) + ' · ' + runShort(c) })])
    ]);
  }
  function field(k, v, cls) { return v == null || v === '' ? null : h('div', { class: 'cpc-f ' + (cls || '') }, [h('span', { class: 'k', text: k }), h('span', { class: 'v' }, Array.isArray(v) ? v : [String(v)])]); }
  function renderDetail() {
    var c = byId[S.id], d = el.detail;
    el.body.classList.toggle('has-detail', !!c); d.hidden = !c; d.innerHTML = '';
    if (!c) { if (map) setTimeout(function () { map.invalidateSize(); }, 0); return; }
    d.className = 'cpc-detail ' + st(c);
    var span = Y1 - Y0, s = c.s || Y0, e = c.e || (c.open ? NOW : Y1), fuzzy = !c.s || (!c.e && !c.open);
    var kids = [
      h('button', { class: 'x', type: 'button', 'aria-label': 'Close', text: '×', onclick: function () { select(''); } }),
      h('button', { class: 'big', type: 'button', 'aria-label': 'Enlarge image', onclick: function () { lightbox(c); } }, [h('img', { src: full(c), alt: c.design || c.po, width: 600, height: 600 })]),
      h('div', {}, [h('h2', { text: c.po }), h('div', { class: 'sub', text: [c.city, c.prov].filter(Boolean).join(', ') })]),
      h('div', { class: 'cpc-fields' }, [
        field('Status', [h('span', { class: 'dot ' + st(c) }), stName(c)], 'st-' + st(c)),
        field('Ink', c.ink ? [h('span', { class: 'swatch', style: 'background:' + (INK[c.ink] || '#888') }), c.ink] : null),
        field('Design', c.design, 'wide'),
        field('Nickname', c.nick),
        field('Designer', c.designer && c.designer !== 'Unknown' ? c.designer : null),
        field('Size', c.w && c.h ? String(c.w).replace(/mm/, '') + ' × ' + String(c.h).replace(/mm/, '') + ' mm' : null),
        field('Added', c.added)
      ]),
      h('div', { class: 'cpc-run' }, [
        h('div', { class: 'lab' }, [h('span', { text: 'Run dates' }), h('span', { class: 'mono', text: c.run || 'Unknown' })]),
        h('div', { class: 'tr' }, [
          h('i', { class: st(c) + (fuzzy ? ' fuzzy' : ''), style: 'left:' + ((s - Y0) / span * 100) + '%;width:' + Math.max(2, (e - s) / span * 100) + '%' }),
          h('b', { style: 'left:' + ((NOW - Y0) / span * 100) + '%', title: 'Today' })
        ]),
        h('div', { class: 'ax mono' }, [h('span', { text: String(Y0) }), h('span', { text: fuzzy ? 'striped = date unknown' : 'line = today' }), h('span', { text: String(Y1) })])
      ]),
      c.tags ? h('div', { class: 'cpc-chips' }, c.tags.map(function (t) {
        return h('button', { class: 'cpc-chip', type: 'button', text: t, onclick: function () { S.tag = t.toLowerCase(); S.id = ''; renderDetail(); go(true); } }); })) : null
    ];
    var ver = (c.prev || []).map(function (i) { return byId[i] && rel(byId[i], 'Earlier version'); })
      .concat((c.next || []).map(function (i) { return byId[i] && rel(byId[i], 'Later version'); })).filter(Boolean);
    if (ver.length) kids.push(h('div', { class: 'cpc-sec' }, [h('h3', { class: 'cpc-h', text: 'Versions of this cancel' })].concat(ver)));
    var linked = (c.prev || []).concat(c.next || []);
    var same = D.filter(function (o) { return o.id !== c.id && linked.indexOf(o.id) < 0 && Math.abs(o.lat - c.lat) < 1e-4 && Math.abs(o.lng - c.lng) < 1e-4; });
    if (same.length) kids.push(h('div', { class: 'cpc-sec' }, [h('h3', { class: 'cpc-h', text: 'Also at this post office' })].concat(same.map(function (o) { return rel(o, o.po); }))));
    kids.push(h('div', { class: 'cpc-sec' }, [
      h('div', { class: 'cpc-fields' }, [field('Address', c.addr || [c.city, c.prov].join(', '), 'wide'), me ? field('Distance', Math.round(dist(me, c)) + ' km from you', 'wide') : null]),
      h('div', { class: 'cpc-actions' }, [
        h('button', { class: 'cpc-btn primary', type: 'button', text: 'Show on map', onclick: function () { showOnMap(c.id); } }),
        h('a', { class: 'cpc-btn', href: 'https://www.google.com/maps/search/?api=1&query=' + c.lat + ',' + c.lng, target: '_blank', rel: 'noopener', text: 'Directions' }),
        h('button', { class: 'cpc-btn', type: 'button', text: 'Copy link', onclick: function () {
          var u = location.href; if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { toast('Link copied'); }); else prompt('Copy this link', u); } })
      ])
    ]));
    kids.forEach(function (k) { if (k) d.appendChild(k); });
    d.scrollTop = 0;
    if (map) setTimeout(function () { map.invalidateSize(); }, 0);
  }
  function lightbox(c) {
    var box = h('div', { class: 'cpc cpc-lightbox', role: 'dialog', 'aria-label': 'Enlarged image' }, [h('img', { src: full(c), alt: c.design || c.po }), h('button', { type: 'button', 'aria-label': 'Close', text: '×' })]);
    function close() { box.remove(); document.removeEventListener('keydown', key); }
    function key(e) { if (e.key === 'Escape') close(); }
    box.addEventListener('click', close); document.addEventListener('keydown', key);
    document.body.appendChild(box); box.querySelector('button').focus();
  }

  /* ---------- actions ---------- */
  function setView(v) {
    S.view = v; el.mapWrap.hidden = v !== 'map'; el.galWrap.hidden = v !== 'gallery';
    el.tabMap.setAttribute('aria-pressed', v === 'map'); el.tabGal.setAttribute('aria-pressed', v === 'gallery');
    if (v === 'map') { if (!leafletReady) loadLeaflet(initMap); else setTimeout(function () { map.invalidateSize(); renderMap(false); }, 0); }
    else renderGallery();
    writeHash();
  }
  function locate() {
    if (!navigator.geolocation) return toast('Location is not available in this browser');
    navigator.geolocation.getCurrentPosition(function (p) {
      me = { lat: p.coords.latitude, lng: p.coords.longitude }; S.sort = 'near'; go();
      if (leafletReady && S.view === 'map') map.setView([me.lat, me.lng], 8);
      toast('Sorted by distance from you');
    }, function () { toast('Could not get your location'); }, { timeout: 8000 });
  }
  function csv() {
    var cols = [['Post Office', 'po'], ['City', 'city'], ['Province', 'prov'], ['Status', 'status'], ['Ink', 'ink'], ['Run Dates', 'run'], ['Design', 'design'], ['Nickname', 'nick'], ['Tags', 'tags'], ['Latitude', 'lat'], ['Longitude', 'lng'], ['Address', 'addr']];
    var q = function (v) { v = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v); return '"' + v.replace(/"/g, '""').replace(/\n/g, ', ') + '"'; };
    var rows = [cols.map(function (c) { return q(c[0]); }).join(',')].concat(filtered.map(function (r) { return cols.map(function (c) { return q(c[1] === 'status' ? stName(r) : r[c[1]]); }).join(','); }));
    var a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv' })), download: 'pictorial-cancels.csv' });
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- update cycle ---------- */
  function update(fit) {
    filtered = sortList(D.filter(function (c) { return match(c); }));
    el.count.innerHTML = '';
    el.count.appendChild(h('b', { text: filtered.length + (filtered.length === 1 ? ' cancel' : ' cancels') }));
    if (filtered.length !== D.length) el.count.appendChild(document.createTextNode(' of ' + D.length));
    el.yOn.checked = !!S.ya; el.yDual.classList.toggle('off', !S.ya);
    if (S.ya) { el.ya.value = S.ya; el.yb.value = S.yb; } paintYears();
    el.sort.value = S.sort;
    renderFilters();
    if (S.view === 'gallery') renderGallery(); else renderMap(fit);
    writeHash();
  }

  /* ---------- boot ---------- */
  readHash(); build();
  el.count.textContent = 'Loading cancels…';
  fetch(BASE + 'data.json?t=' + Math.floor(Date.now() / 36e5)).then(function (r) { return r.json(); }).then(function (j) {
    D = j.cancels; updated = j.updated;
    D.forEach(function (c, i) { c._o = i; byId[c.id] = c; c._t = (c.tags || []).map(function (t) { return t.toLowerCase(); });
      c._s = [c.po, c.city, c.prov, c.pc, c.design, c.nick, c._t.join(' '), c.designer, c.ink].join(' ').toLowerCase(); });
    if (S.sort === 'near') S.sort = 'place';
    var pg = S.page; setView(S.view); update(true); if (pg > 1 && S.view === 'gallery') { S.page = pg; renderGallery(); writeHash(); }
    if (S.id && byId[S.id]) select(S.id); else S.id = '';
  }).catch(function () { el.count.textContent = 'The cancel list could not be loaded. Please try again later.'; });
  window.addEventListener('hashchange', function () { var id = S.id; readHash(); el.search.value = S.q; setView(S.view); update(true); if (S.id !== id) select(S.id); });
})();
