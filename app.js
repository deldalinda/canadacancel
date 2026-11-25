/* Canada's Pictorial Cancels — single-file app. Mounts into #cpc-app. */
(function () {
  'use strict';
  var script = document.currentScript;
  var BASE = (script && script.src) ? script.src.replace(/[^/]*$/, '') : './';
  var root = document.getElementById('cpc-app');
  if (!root) return;
  var NOW = new Date().getFullYear(), Y0 = 2001, Y1 = 2036, TAGSTEP = 12;
  var INK = { Black: '#1A1A1A', Red: '#D52B1E', Blue: '#1F4FBF', Green: '#1B7F4B', Pink: '#E86AA6' };
  var S = { view: 'map', q: '', act: true, exp: true, prov: [], tag: [], ink: [], ya: null, yb: null, soon: false, sort: 'place', id: '', per: 50, page: 1, cmp: [], cmpOpen: false, dir: 1, area: null, strip: store('cpc-strip') !== '0' };
  var CMPMAX = 5;
  var D = [], byId = {}, updated = '', me = null, tagN = TAGSTEP;
  var map, cluster, markers = {}, leafletReady = false, filtered = [], needFit = false;
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
    ['prov', 'tag', 'ink'].forEach(function (k) { if (S[k].length) p.set(k, S[k].join(',')); });
    if (S.id) p.set('id', S.id);
    if (S.ya) p.set('years', S.ya + '-' + S.yb);
    if (S.soon) p.set('soon', '1');
    if (S.sort !== 'prov') p.set('sort', S.sort);
    if (S.dir !== defDir(S.sort)) p.set('dir', S.dir > 0 ? 'up' : 'down');
    if (S.per !== 50) p.set('per', S.per);
    if (S.page > 1) p.set('page', S.page);
    if (S.cmp.length) p.set('cmp', S.cmp.join(','));
    if (S.cmpOpen && S.cmp.length) p.set('compare', '1');
    if (S.about) p.set('about', '1');
    if (S.area) p.set('area', S.area.join(','));
    var s = p.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }
  function readHash() {
    var p = new URLSearchParams(location.hash.replace(/^#/, '')), y = /^(\d{4})-(\d{4})$/.exec(p.get('years') || '');
    S.view = ['gallery', 'timeline'].indexOf(p.get('view')) > -1 ? p.get('view') : 'map';
    S.q = p.get('q') || ''; S.act = p.get('active') !== '0'; S.exp = p.get('expired') !== '0';
    var list = function (k) { return (p.get(k) || '').split(',').filter(Boolean); };
    S.prov = list('prov'); S.tag = list('tag'); S.ink = list('ink');
    S.ya = y ? +y[1] : null; S.yb = y ? +y[2] : null; S.soon = p.get('soon') === '1';
    S.sort = { place: 'prov', oldest: 'run', ending: 'run' }[p.get('sort')] || p.get('sort') || 'prov';
    if (!SORTS[S.sort]) S.sort = 'prov';
    S.dir = p.get('dir') === 'up' ? 1 : p.get('dir') === 'down' ? -1 : defDir(S.sort); S.id = p.get('id') || '';
    S.per = p.get('per') === 'all' ? 'all' : (parseInt(p.get('per'), 10) || 50); S.page = parseInt(p.get('page'), 10) || 1;
    S.cmp = (p.get('cmp') || '').split(',').filter(Boolean).slice(0, CMPMAX); S.cmpOpen = p.get('compare') === '1'; S.about = p.get('about') === '1';
    var ar = (p.get('area') || '').split(',').map(Number); S.area = ar.length === 4 && ar.every(isFinite) ? ar : null;
  }

  /* ---------- filtering ---------- */
  function match(c, skip) {
    if (expired(c) ? !S.exp : !S.act) return false;
    if (skip !== 'prov' && S.prov.length && S.prov.indexOf(c.prov) < 0) return false;
    if (skip !== 'ink' && S.ink.length && S.ink.indexOf(c.ink) < 0) return false;
    if (S.soon && !(c.status === 'Active' && c.e && c.e <= NOW + 1)) return false;
    if (S.ya && !inRange(c, S.ya, S.yb)) return false;
    if (skip !== 'tag' && S.tag.length && !S.tag.some(function (t) { return c._t.indexOf(t) > -1; })) return false;
    if (S.q) { var w = S.q.toLowerCase().split(/\s+/).filter(Boolean); for (var i = 0; i < w.length; i++) if (c._s.indexOf(w[i]) < 0) return false; }
    return true;
  }
  var SORTS = { prov: ['Province', 'A → Z', 'Z → A'], po: ['Post office', 'A → Z', 'Z → A'], added: ['Added time', 'Earliest first', 'Latest first'],
    run: ['Run dates', 'Earliest first', 'Latest first'], lng: ['East ↔ West', 'West → East', 'East → West'] };
  function defDir(k) { return k === 'added' ? -1 : 1; }
  function paintSort() {
    el.sort.value = S.sort;
    var t = SORTS[S.sort], up = S.dir > 0;
    el.sortDir.textContent = (up ? '↑ ' : '↓ ') + (up ? t[1] : t[2]);
    el.sortDir.setAttribute('aria-label', 'Order: ' + (up ? t[1] : t[2]) + '. Click to reverse');
  }
  function sortList(list) {
    var d = S.dir, key = {
      prov: function (c) { return c.prov; },
      po: function (c) { return c.po; },
      added: function (c) { return c.added || null; },
      run: function (c) { return c.s || null; },
      lng: function (c) { return c.lng != null ? c.lng : null; }
    }[S.sort] || function (c) { return c.prov; };
    return list.slice().sort(function (a, b) {
      var x = key(a), y = key(b);
      if (x == null || y == null) { if (x == null && y == null) return a._o - b._o; return x == null ? 1 : -1; }
      var r = typeof x === 'string' ? x.localeCompare(y, 'en', { sensitivity: 'base' }) : x - y;
      return r * d || a._o - b._o;
    });
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
    el.tabTl = h('button', { class: 'cpc-tab', type: 'button', text: 'Timeline', onclick: function () { setView('timeline'); } });
    var top = h('header', { class: 'cpc-top' }, [
      h('a', { class: 'cpc-home', href: 'https://lindasartworld.ca/canadacancels/', title: 'Canada\u2019s Pictorial Cancels: home' }, [
        h('img', { class: 'cpc-logo', src: BASE + 'logo.png', alt: '', width: 64, height: 64 }),
        h('div', { class: 'cpc-ttl' }, [h('h1', { class: 'cpc-title', text: "Canada's Pictorial Cancels" }), el.sub = h('p', { class: 'cpc-sub' })])]),
      h('button', { class: 'cpc-aboutb', type: 'button', text: 'About', 'aria-haspopup': 'dialog', onclick: function () { openAbout(); } }),
      h('nav', { class: 'cpc-tabs', 'aria-label': 'Views' }, [el.tabMap, el.tabGal, el.tabTl])
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
    el.sort = h('select', { class: 'cpc-btn', 'aria-label': 'Sort by', onchange: function () {
      S.sort = el.sort.value; S.dir = defDir(S.sort); go(); } },
      Object.keys(SORTS).map(function (k) { return h('option', { value: k, text: SORTS[k][0] }); }));
    el.sortDir = h('button', { class: 'cpc-btn cpc-dir', type: 'button', onclick: function () { S.dir = -S.dir; go(); } });
    el.sortBox = h('div', { class: 'cpc-sort', role: 'group', 'aria-label': 'Sort' }, [h('span', { class: 'l', text: 'Sort by' }), el.sort, el.sortDir]);
    var bar = h('div', { class: 'cpc-bar' }, [
      h('button', { class: 'cpc-btn cpc-filtertoggle', type: 'button', text: 'Filters', onclick: function () { el.filters.classList.toggle('open'); } }),
      h('label', { class: 'cpc-search' }, [svg('M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-3.5-3.5'), el.search]),
      h('div', { class: 'cpc-year' }, [el.count, h('label', {}, [el.yOn, 'in use between']), el.yOut, el.yDual]),
      el.sortBox,
      el.dl = h('select', { class: 'cpc-btn', 'aria-label': 'Download the selection', onfocus: paintDl, onmousedown: paintDl, onchange: function () { var v = el.dl.value; el.dl.value = ''; if (v === 'csv') csv(); else if (v === 'kml') kml(); else if (v) zip(v); } }, [
        h('option', { value: '', text: 'Download the selection…' }), el.dlHead = h('option', { value: '', disabled: '', text: '' }), h('option', { value: 'csv', text: 'List only (CSV)' }), h('option', { value: 'kml', text: 'Map file with images, for Google My Maps (KML)' }),
        h('option', { value: 'thumb', text: 'List + small images (ZIP)' }), h('option', { value: 'full', text: 'List + full images (ZIP)' })])
    ]);
    el.fbody = h('div', { class: 'cpc-fbody' });
    el.grip = h('button', { class: 'cpc-grip', type: 'button', 'aria-label': 'Drag to resize the filter panel', title: 'Drag to resize' });
    el.filters = h('aside', { class: 'cpc-filters', 'aria-label': 'Filters' }, [el.fbody, el.grip]);
    grip();
    el.stripB = h('button', { class: 'cpc-stripb', type: 'button', onclick: function () {
      S.strip = !S.strip; store('cpc-strip', S.strip ? '1' : '0'); paintStrip();
      if (map) setTimeout(function () { map.invalidateSize({ pan: false }); renderStrip(); }, 0); } });
    el.mapWrap = h('div', { class: 'cpc-mapw' }, [
      el.map = h('div', { class: 'cpc-map', role: 'application', 'aria-label': 'Map of post offices with pictorial cancels' }),
      h('section', { class: 'cpc-stripbox', 'aria-label': 'Cancels in this part of the map' }, [h('div', { class: 'cpc-strip-h' }, [el.stripT = h('span', { role: 'status' }), el.stripB, h('span')]), el.strip = h('div', { class: 'cpc-strip' })])
    ]);
    paintStrip();
    el.tlWrap = h('div', { class: 'cpc-tl' });
    el.tools = h('div', { class: 'cpc-tools' }); el.tools2 = h('div', { class: 'cpc-tools foot' });
    el.galWrap = h('div', {}, [el.tools, el.grid = h('div', { class: 'cpc-grid' }), el.tools2]);
    el.detail = h('aside', { class: 'cpc-detail', 'aria-label': 'Selected cancel', hidden: true });
    el.body = h('div', { class: 'cpc-body' }, [el.filters, h('main', {}, [el.mapWrap, el.galWrap, el.tlWrap]), el.detail]);
    el.tray = h('div', { class: 'cpc-tray', role: 'region', 'aria-label': 'Comparison', hidden: true });
    el.cmp = h('div', { class: 'cpc-compare', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Compare cancels', hidden: true });
    root.appendChild(top); root.appendChild(bar); root.appendChild(el.body); root.appendChild(el.tray); root.appendChild(el.cmp);
    el.about = h('div', { class: 'cpc-about', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'About this project', hidden: true }); root.appendChild(el.about);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.cmpOpen && !document.querySelector('.cpc-lightbox')) closeCompare(); if (e.key === 'Escape' && S.about) closeAbout(); });
  }
  function paintStrip() {
    el.mapWrap.classList.toggle('nostrip', !S.strip); el.strip.hidden = !S.strip;
    el.stripB.textContent = S.strip ? '▼' : '▲';
    el.stripB.setAttribute('aria-expanded', S.strip ? 'true' : 'false');
    el.stripB.setAttribute('aria-label', (S.strip ? 'Hide' : 'Show') + ' the cancels in this part of the map');
    el.stripB.title = S.strip ? 'Hide' : 'Show';
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
  /* sidebar counts follow what is on screen: in map view only the visible part of the map counts */
  function inScope(c) {
    if (S.view !== 'map' || !leafletReady) return inArea(c);
    var b = map.getBounds(); return b.contains([c.lat, c.lng]);
  }
  /* the map area last looked at ([south, west, north, east]) also limits Gallery and Timeline */
  function paintCount() { var nL = listed().length; el.count.innerHTML = ''; el.count.appendChild(h('b', { text: nL + (nL === 1 ? ' cancel' : ' cancels') })); }
  function inArea(c) { var a = S.area; return !a || (c.lat >= a[0] && c.lat <= a[2] && c.lng >= a[1] && c.lng <= a[3]); }
  function listed() { return S.view === 'map' ? filtered : filtered.filter(inArea); }
  function areaCut() { return S.view !== 'map' && S.area && listed().length < filtered.length; }
  function clearArea() { S.area = null; needFit = true; update(); }
  function areaNote() {
    if (!areaCut()) return null;
    var n = listed().length;
    return h('div', { class: 'cpc-areanote' }, [h('span', {}, [h('b', { text: n + (n === 1 ? ' cancel' : ' cancels') }), ' in the part of the map you were viewing']),
      h('button', { class: 'cpc-btn', type: 'button', text: 'Show all of Canada', onclick: clearArea })]);
  }
  function tog(arr, v) { var i = arr.indexOf(v); if (i < 0) arr.push(v); else arr.splice(i, 1); }
  function renderFilters() {
    var a = S.act, x = S.exp; S.act = S.exp = true;
    var base = D.filter(function (c) { return match(c) && inScope(c); }); S.act = a; S.exp = x;
    var nA = base.filter(function (c) { return !expired(c); }).length, nE = base.length - nA;
    var f = el.fbody; f.innerHTML = '';
    f.appendChild(h('div', {}, [h('h2', { class: 'cpc-h', text: 'Status' }), h('div', { class: 'cpc-chips' }, [
      chip([h('span', { class: 'dot' }), 'Active', h('small', { text: String(nA) })], S.act, function () { S.act = !S.act; if (!S.act && !S.exp) S.exp = true; go(); }, 'st active'),
      chip([h('span', { class: 'dot expired' }), 'Expired', h('small', { text: String(nE) })], S.exp, function () { S.exp = !S.exp; if (!S.act && !S.exp) S.act = true; go(); }, 'st expired'),
      chip(['Ending by ' + (NOW + 1)], S.soon, function () { S.soon = !S.soon; go(); })
    ])]));
    var tc = {}; D.forEach(function (c) { if (match(c, 'tag') && inScope(c)) c._t.forEach(function (t) { tc[t] = (tc[t] || 0) + 1; }); });
    var tags = Object.keys(tc).sort(function (p, q) { return tc[q] - tc[p] || p.localeCompare(q); });
    if (S.tag.length) tags = S.tag.concat(tags.filter(function (t) { return S.tag.indexOf(t) < 0; }));
    var chips = tags.slice(0, Math.max(tagN, S.tag.length)).map(function (t) { return chip([t, h('small', { text: String(tc[t] || 0) })], S.tag.indexOf(t) > -1, function () { tog(S.tag, t); go(); }); });
    if (tags.length > tagN) chips.push(h('button', { class: 'cpc-chip more', type: 'button', text: 'Load more (' + (tags.length - tagN) + ')', onclick: function () { tagN += TAGSTEP; renderFilters(); } }));
    else if (tagN > TAGSTEP) chips.push(h('button', { class: 'cpc-chip more', type: 'button', text: 'Show fewer', onclick: function () { tagN = TAGSTEP; renderFilters(); } }));
    f.appendChild(h('div', {}, [h('h2', { class: 'cpc-h', text: 'Theme' }), h('div', { class: 'cpc-chips' }, chips.length ? chips : [h('small', { text: 'No tags in this selection' })])]));
    f.appendChild(h('div', {}, [h('h2', { class: 'cpc-h', text: 'Ink colour' }), h('div', { class: 'cpc-chips' },
      Object.keys(INK).map(function (k) { return chip([h('span', { class: 'swatch', style: 'background:' + INK[k] }), k], S.ink.indexOf(k) > -1, function () { tog(S.ink, k); go(); }); }))]));
    var pv = {}, max = 1;
    D.forEach(function (c) { pv[c.prov] = pv[c.prov] || [0, 0]; if (match(c, 'prov')) pv[c.prov][expired(c) ? 1 : 0]++; });
    Object.keys(pv).forEach(function (k) { max = Math.max(max, pv[k][0] + pv[k][1]); });
    f.appendChild(h('div', {}, [h('h2', { class: 'cpc-h', text: 'Province or territory' })].concat(
      Object.keys(pv).sort(function (p, q) { return (pv[q][0] + pv[q][1]) - (pv[p][0] + pv[p][1]) || p.localeCompare(q); }).map(function (k) {
        return h('button', { class: 'cpc-prov', type: 'button', 'aria-pressed': S.prov.indexOf(k) > -1 ? 'true' : 'false', 'aria-label': k + ': ' + pv[k][0] + ' active, ' + pv[k][1] + ' expired',
          onclick: function () { tog(S.prov, k); go(true); } }, [
          h('span', { class: 'n', text: k }),
          h('span', { class: 'bar' }, [h('i', { style: 'width:' + (pv[k][0] / max * 100) + '%' }), h('i', { style: 'width:' + (pv[k][1] / max * 100) + '%' })]),
          h('span', { class: 'c mono', text: String(pv[k][0] + pv[k][1]) })
        ]);
      }))));
    if (S.q || S.prov.length || S.tag.length || S.ink.length || S.ya || S.soon || !S.act || !S.exp)
      f.appendChild(h('button', { class: 'cpc-clear', type: 'button', text: 'Clear all filters', onclick: function () {
        S.q = ''; S.prov = []; S.tag = []; S.ink = []; S.ya = S.yb = null; S.soon = false; S.act = S.exp = true; el.search.value = ''; go(true); } }));
  }
  function go(fit) { S.page = 1; if (fit) { S.area = null; needFit = true; } update(fit); }

  /* ---------- cards, gallery ---------- */
  function card(c) {
    var isNew = updated && (new Date(updated) - new Date(c.added)) < 60 * 864e5, on = S.cmp.indexOf(c.id) > -1;
    return h('div', { class: 'cpc-card ' + st(c) + (on ? ' cmp-on' : ''), 'aria-current': S.id === c.id ? 'true' : null }, [
      h('button', { class: 'main', type: 'button', onclick: function () { select(c.id); } }, [
        h('span', { class: 'imw' }, [
          h('img', { class: 'im', src: thumb(c), alt: c.design || c.po, loading: 'lazy', decoding: 'async', width: 360, height: 360 }),
          h('span', { class: 'cpc-badge ' + st(c), text: stName(c) }),
          isNew ? h('span', { class: 'cpc-new', text: 'NEW' }) : null,
          c.story ? h('span', { class: 'cpc-story', text: 'Design story' }) : null
        ]),
        h('span', { class: 'tx' }, [
          h('span', { class: 'po', text: c.po, title: c.po }),
          h('span', { class: 'de', text: label(c) }),
          h('span', { class: 'r3' }, [h('span', { class: 'pv', text: c.prov }), h('span', { class: 'mono', text: runShort(c) })])
        ])
      ]),
      h('span', { class: 'cmpwrap' }, [cmpBtn(c, true)])
    ]);
  }
  function cmpBtn(c, small) {
    var on = S.cmp.indexOf(c.id) > -1;
    return h('button', { class: small ? 'cpc-cmp' : 'cpc-btn cpc-cmpbig', type: 'button', 'data-cmp': c.id, 'aria-pressed': on ? 'true' : 'false',
      'aria-label': (on ? 'Remove ' : 'Add ') + c.po + ' ' + label(c) + (on ? ' from comparison' : ' to comparison'), title: on ? 'Remove from comparison' : 'Add to comparison',
      onclick: function (e) { e.stopPropagation(); toggleCmp(c.id); } }, small ? [h('span', { 'aria-hidden': 'true', text: on ? '✓' : '+' }), h('span', { class: 't', text: 'Compare' })] : [on ? 'In comparison' : 'Compare']);
  }
  function toggleCmp(id) {
    var i = S.cmp.indexOf(id);
    if (i > -1) S.cmp.splice(i, 1);
    else if (S.cmp.length >= CMPMAX) return toast('You can compare up to ' + CMPMAX + ' cancels. Remove one first.');
    else S.cmp.push(id);
    root.querySelectorAll('[data-cmp="' + id + '"]').forEach(function (b) { var nb = cmpBtn(byId[id], b.classList.contains('cpc-cmp')); b.replaceWith(nb); var cd = nb.closest('.cpc-card'); if (cd) cd.classList.toggle('cmp-on', i < 0); });
    renderTray(); if (S.cmpOpen) renderCompare(); writeHash();
  }
  function renderTray() {
    var t = el.tray; t.innerHTML = ''; t.hidden = !S.cmp.length;
    root.classList.toggle('has-tray', !!S.cmp.length);
    if (!S.cmp.length) { if (S.cmpOpen) closeCompare(); return; }
    t.appendChild(h('span', { class: 'lab', text: 'Compare ' + S.cmp.length + ' of ' + CMPMAX }));
    var list = h('span', { class: 'list' });
    S.cmp.forEach(function (id) { var c = byId[id]; if (!c) return;
      list.appendChild(h('span', { class: 'it ' + st(c) }, [
        h('img', { src: thumb(c), alt: '', width: 44, height: 44 }),
        h('button', { class: 'rm', type: 'button', 'aria-label': 'Remove ' + c.po + ' ' + label(c) + ' from comparison', text: '×', onclick: function () { toggleCmp(id); } })
      ])); });
    for (var k = S.cmp.length; k < CMPMAX; k++) list.appendChild(h('span', { class: 'it empty', 'aria-hidden': 'true' }));
    t.appendChild(list);
    t.appendChild(h('button', { class: 'cpc-btn primary', type: 'button', text: S.cmp.length < 2 ? 'Pick one more' : 'Compare', disabled: S.cmp.length < 2 ? '' : null, onclick: openCompare }));
    t.appendChild(h('button', { class: 'clr', type: 'button', text: 'Clear', onclick: function () { var ids = S.cmp.slice(); S.cmp = []; ids.forEach(function (id) { S.cmp.push(id); toggleCmp(id); }); } }));
  }
  function openCompare() { if (S.cmp.length < 2) return; S.cmpOpen = true; renderCompare(); writeHash(); }
  function closeCompare() { S.cmpOpen = false; el.cmp.hidden = true; el.cmp.innerHTML = ''; document.documentElement.style.overflow = ''; writeHash(); }
  function renderCompare() {
    var list = S.cmp.map(function (id) { return byId[id]; }).filter(Boolean), m = el.cmp;
    if (list.length < 2) return closeCompare();
    var diffOnly = m._diff || false, span = Y1 - Y0;
    m.innerHTML = ''; m.hidden = false; document.documentElement.style.overflow = 'hidden';
    function tl(c) { var s0 = c.s || Y0, e0 = c.e || (c.open ? NOW : Y1), fz = !c.s || (!c.e && !c.open);
      return h('div', { class: 'cpc-run' }, [h('div', { class: 'tr' }, [h('i', { class: st(c) + (fz ? ' fuzzy' : ''), style: 'left:' + ((s0 - Y0) / span * 100) + '%;width:' + Math.max(2, (e0 - s0) / span * 100) + '%' }), h('b', { style: 'left:' + ((NOW - Y0) / span * 100) + '%' })])]); }
    var rows = [
      ['Run dates', function (c) { return c.run || 'Unknown'; }, function (c) { return [h('div', { text: c.run || 'Unknown' }), tl(c)]; }],
      ['Status', function (c) { return stName(c); }, function (c) { return [h('span', { class: 'cpc-badge ' + st(c), text: stName(c) })]; }],
      ['Colour', function (c) { return c.ink || '—'; }, function (c) { return [h('span', { class: 'swatch', style: 'background:' + (INK[c.ink] || '#888') }), c.ink || '—']; }],
      ['Designer', function (c) { return c.designer || 'Unknown'; }],
      ['Province', function (c) { return c.prov; }],
      ['Coordinates', function (c) { return coords(c); }],
      ['Design', function (c) { return c.design || '—'; }],
      ['Tags', function (c) { return (c.tags || []).join(', ') || '—'; }, function (c) { return [h('span', { class: 'cpc-chips' }, (c.tags || []).map(function (t) { return h('span', { class: 'cpc-chip', text: t }); }))]; }],
      ['Address', function (c) { return c.addr || ''; }],
      me ? ['Distance', function (c) { return Math.round(dist(me, c)) + ' km from you'; }] : null
    ].filter(Boolean);
    var cols = 'grid-template-columns:140px repeat(' + list.length + ',minmax(190px,1fr))';
    var grid = h('div', { class: 'grid', style: cols, role: 'table', 'aria-label': 'Comparison of ' + list.length + ' cancels' });
    grid.appendChild(h('div', { class: 'c k head', role: 'columnheader' }));
    list.forEach(function (c) {
      grid.appendChild(h('div', { class: 'c head ' + st(c), role: 'columnheader' }, [
        h('button', { class: 'rm', type: 'button', 'aria-label': 'Remove ' + c.po + ' from comparison', text: '×', onclick: function () { toggleCmp(c.id); } }),
        h('button', { class: 'pic', type: 'button', 'aria-label': 'Enlarge image', onclick: function () { lightbox(c); } }, [h('img', { src: full(c), alt: c.design || c.po, width: 400, height: 400 })]),
        h('button', { class: 'nm', type: 'button', title: 'Open this cancel', onclick: function () { closeCompare(); select(c.id); } }, [h('strong', { text: c.po }), c.nick ? h('span', { text: '“' + cap(c.nick) + '”' }) : null])
      ]));
    });
    rows.forEach(function (r) {
      var vals = list.map(r[1]), same = vals.every(function (v) { return v === vals[0]; });
      if (diffOnly && same) return;
      grid.appendChild(h('div', { class: 'c k' + (same ? '' : ' diff'), role: 'rowheader' }, [r[0], same ? null : h('span', { class: 'flag', title: 'Values differ', text: 'differs' })]));
      list.forEach(function (c, i) { grid.appendChild(h('div', { class: 'c v' + (same ? '' : ' diff'), role: 'cell' }, r[2] ? r[2](c) : [String(vals[i])])); });
    });
    var diffBox = h('input', { type: 'checkbox', onchange: function () { m._diff = diffBox.checked; renderCompare(); } }); diffBox.checked = diffOnly;
    m.appendChild(h('div', { class: 'bar' }, [
      h('h2', { text: 'Comparing ' + list.length + ' cancels' }),
      h('label', {}, [diffBox, 'Only show rows that differ']),
      h('button', { class: 'cpc-btn', type: 'button', text: 'Close', onclick: closeCompare })
    ]));
    m.appendChild(h('div', { class: 'scroll' }, [grid]));
    var cb = m.querySelector('.bar .cpc-btn'); if (cb && !m.contains(document.activeElement)) cb.focus();
  }
  function pages() { return S.per === 'all' ? 1 : Math.max(1, Math.ceil(listed().length / S.per)); }
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
  function applyCols() {
    if (!el.zoom) return;
    var w = el.grid.clientWidth || el.galWrap.clientWidth || root.clientWidth || 360;
    var m = Math.max(2, Math.floor((w + 14) / (96 + 14)));
    var c = +store('cpc-cols') || Math.max(1, Math.round(w / 210));
    c = Math.min(m, Math.max(1, c));
    root.style.setProperty('--cols', c);
    el.zoom.max = m; el.zoom.value = m + 1 - c;
    el.zoom.setAttribute('aria-valuetext', c + (c === 1 ? ' cancel' : ' cancels') + ' per row');
  }
  window.addEventListener('resize', debounce(applyCols, 150));
  var colsObs = window.ResizeObserver ? new ResizeObserver(debounce(applyCols, 100)) : null, colsObserved = false;
  function renderGallery() {
    var list = listed(), total = list.length, n = pages(); if (S.page > n) S.page = n;
    var per = S.per === 'all' ? total : S.per, from = (S.page - 1) * per, opts = [];
    for (var v = 50; v < total; v += 50) opts.push(v);
    var sel = h('select', { 'aria-label': 'Results per page', onchange: function () { S.per = sel.value === 'all' ? 'all' : +sel.value; S.page = 1; renderGallery(); writeHash(); } },
      opts.map(function (o) { return h('option', { value: o, text: String(o) }); }).concat([h('option', { value: 'all', text: 'All' })]));
    sel.value = S.per === 'all' || S.per >= total ? 'all' : String(S.per);
    /* image size = cancels per row; the slider has as many steps as fit on this screen (right = bigger images) */
    el.zoom = h('input', { type: 'range', min: 1, max: 2, step: 1, value: 1, 'aria-label': 'Image size',
      oninput: function () { var m = +el.zoom.max; store('cpc-cols', m + 1 - el.zoom.value); applyCols(); } });
    el.tools.innerHTML = ''; el.tools2.innerHTML = ''; el.grid.innerHTML = '';
    var note = areaNote(); if (note) el.tools.appendChild(note);
    el.tools.appendChild(h('label', {}, ['Per page', sel, 'of ' + total + (total === 1 ? ' result' : ' results')]));
    el.tools.appendChild(pager());
    el.tools.appendChild(h('label', { class: 'cpc-zoom' }, ['Image size', el.zoom]));
    applyCols(); if (colsObs && !colsObserved) { colsObs.observe(el.galWrap); colsObserved = true; }
    if (!total) { el.grid.appendChild(h('div', { class: 'cpc-empty', style: 'grid-column:1/-1', text: 'No cancels match these filters.' })); return; }
    var frag = document.createDocumentFragment();
    list.slice(from, from + per).forEach(function (c) { frag.appendChild(card(c)); });
    el.grid.appendChild(frag);
    el.tools2.appendChild(pager());
  }

  /* ---------- about ---------- */
  var PEOPLE = [
    ['Linda', 'Website administrator', 'Montreal', 'tigerbike-1.jpg', [['Website', 'https://lindasartworld.ca/'], ['Instagram', 'https://www.instagram.com/lindapolytope/'], ['Facebook', 'https://www.facebook.com/linda.polytope/']]],
    ['Autumn', 'Contributor', 'Calgary', 'autumn-1.jpeg', [['Blog', 'https://stamp-licker.blogspot.com/'], ['Instagram', 'https://www.instagram.com/ordinarylionpostcards/']]],
    ['Lizi', 'Contributor', 'Vancouver', 'lizi-1.jpg', [['Instagram', 'https://www.instagram.com/lizi.collections/']]],
    ['Rebecca', 'Contributor', 'Toronto', 'rebecca-1.jpg', [['Instagram', 'https://instagram.com/viaairmailstationery']]],
    ['Stephanie', 'Contributor', 'Vancouver', 'stephanie-3.jpg', [['Instagram', 'https://www.instagram.com/shescreams.postcard/'], ['Facebook', 'https://www.facebook.com/stephanieannmackay']]]
  ];
  function ext(href, text) { return h('a', { href: href, target: '_blank', rel: 'noopener', text: text }); }
  function openAbout() { S.about = true; renderAbout(); writeHash(); }
  function closeAbout() { S.about = false; el.about.hidden = true; el.about.innerHTML = ''; document.documentElement.style.overflow = ''; writeHash(); }
  function renderAbout() {
    var a = el.about, nP = {}; D.forEach(function (c) { nP[c.prov] = 1; });
    var stories = D.filter(function (c) { return c.story; });
    a.innerHTML = ''; a.hidden = false; document.documentElement.style.overflow = 'hidden';
    var close = h('button', { class: 'x', type: 'button', 'aria-label': 'Close', text: '×', onclick: closeAbout });
    var body = h('div', { class: 'in' }, [
      h('header', { class: 'hd' }, [h('img', { src: BASE + 'logo.png', alt: '', width: 72, height: 72 }), h('div', {}, [h('p', { class: 'eb', text: 'About' }), h('h2', { text: "Canada's Pictorial Cancels" })]), close]),
      h('section', {}, [
        h('p', { class: 'lead', text: 'This site gathers information about the regular pictorial cancels offered by post offices across Canada, the world’s second-largest country. First-day-of-issue cancels are not included.' }),
        h('p', {}, ['Canada Post offers a wealth of beautifully designed pictorial cancels, but collecting them can be a challenge: the few places online where cancel information can be found, such as ', ext('https://stampraider.blogspot.com/p/canada-post-pictoral-cancels.html', 'this blog post from Stamp Raider'), ' and ', ext('https://www.canadapost-postescanada.ca/cpc/en/personal/collectibles/pictorial-cancels.page', 'Canada Post’s own list'), ', are far from complete, and none of them gives cancel dimensions. This site aims to fill that gap.']),
        h('ul', { class: 'stats' }, [h('li', {}, [h('b', { text: String(D.length) }), ' cancels']), h('li', {}, [h('b', { text: String(Object.keys(nP).length) }), ' provinces and territories']), h('li', {}, [h('b', { text: String(D.filter(function (c) { return !expired(c); }).length) }), ' still in use'])])
      ]),
      h('section', {}, [h('h3', { text: 'How a cancel works' }),
        h('p', { text: 'A pictorial cancel is a rubber stamp made by Canada Post. Its date uses rotating dials: the day and month turn separately, while the year is a single band of 12 years (for example 2020 to 2031). So most designs are made to last 12 years. After that, the post office and Canada Post decide whether to renew the same design, change it slightly, or retire it. A few are much shorter-lived: BP St-Valentin gets a new design every year.' }),
        h('p', {}, [ext('https://canadacancel.wordpress.com/2024/04/02/dissecting-canada-posts-cancel/', 'Read more: Dissecting Canada Post’s cancel →')])]),
      h('section', {}, [h('h3', { text: 'Collecting by mail' }),
        h('p', { text: 'Most active cancels can be collected without leaving home. Our guide explains how to prepare covers, write to the postmaster and get them back.' }),
        h('p', {}, [ext('https://canadacancel.wordpress.com/2026/11/24/how-to-collect-canadian-pictorial-cancels-by-mail/', 'How to collect Canadian pictorial cancels by mail →'), h('br'), h('span', { lang: 'fr' }, [ext('https://canadacancel.wordpress.com/2026/11/25/comment-collectionner-obliterations-illustrees-par-la-poste/', 'En français : Comment collectionner les oblitérations illustrées par la poste →')])])]),
      stories.length ? h('section', {}, [h('h3', { text: 'Design stories' }), h('p', { text: 'Some cancels in this collection were designed by our team. Their stories tell how each design came about.' }),
        h('div', { class: 'stories' }, stories.map(function (c) { return h('a', { class: 'st', href: c.story, target: '_blank', rel: 'noopener' }, [h('img', { src: thumb(c), alt: '', loading: 'lazy', width: 72, height: 72 }), h('span', {}, [h('strong', { text: c.po }), h('small', { text: label(c) })])]); }))]) : null,
      h('section', {}, [h('h3', { text: 'The team' }), h('div', { class: 'people' }, PEOPLE.map(function (p) {
        return h('div', { class: 'pp' }, [h('img', { src: 'https://canadacancel.wordpress.com/wp-content/uploads/' + (p[3] === 'rebecca-1.jpg' ? '2024/06/' : '2024/03/') + p[3] + '?w=200', alt: '', loading: 'lazy', width: 72, height: 72 }),
          h('div', {}, [h('strong', { text: p[0] }), h('small', { text: p[1] + ' · ' + p[2] }), h('span', { class: 'ln' }, p[4].map(function (l) { return ext(l[1], l[0]); }))])]); }))]),
      h('section', { class: 'two' }, [
        h('div', {}, [h('h3', { text: 'Know a cancel that’s missing?' }), h('p', { text: 'Tell us about it and we’ll add it to the collection.' }), h('a', { class: 'cpc-btn primary', href: 'https://airtable.com/appYNSlTbmzBhwq3o/pagI8bgsoflVMGmYB/form', target: '_blank', rel: 'noopener', text: 'Report a missing cancel' })]),
        h('div', {}, [h('h3', { text: 'Contact' }), h('p', {}, [ext('mailto:deldal@gmail.com', 'deldal@gmail.com'), h('br'), ext('https://www.instagram.com/canada.cancel/', 'Instagram: @canada.cancel')])])
      ]),
      h('section', { class: 'fine' }, [
        h('p', { text: 'Thank you to A. Andriasian for donations that support this project.' }),
        h('p', {}, ['Everything on this site is licensed under ', ext('https://creativecommons.org/licenses/by-nc/4.0/', 'Creative Commons Attribution-NonCommercial (CC BY-NC)'), '. Feel free to use it for non-commercial purposes.']),
        updated ? h('p', { text: 'Data last updated ' + updated + '.' }) : null
      ])
    ]);
    a.appendChild(h('div', { class: 'bg', onclick: closeAbout })); a.appendChild(body); close.focus();
  }

  /* ---------- timeline ---------- */
  function tlSegs(c) {
    var A = expired(c) ? 'e' : 'a', s = c.s, e = c.e;
    if (s && e) return [[s, e, A]];
    if (s && c.open) return [[s, NOW, A]];
    if (!s && c.open) return [[Y0, NOW - 1.5, 'u'], [NOW - 1.5, NOW, A]];
    if (s) return [[s, Math.min(s + 1, NOW), A], [Math.min(s + 1, NOW), NOW, 'u']];
    if (e) return [[Y0, e - 1, 'u'], [e - 1, e, A]];
    return [[Y0, NOW, 'u']];
  }
  function renderTimeline() {
    var w = el.tlWrap, span = Y1 - Y0, x = function (y) { return (y - Y0) / span * 100; }, step = 5 / span * 100 + '%';
    w.innerHTML = '';
    w.appendChild(h('div', { class: 'cpc-tl-leg' }, [h('span', { text: 'When was each cancel in use?' }),
      h('span', { class: 'k' }, [h('i', { class: 'a' }), 'Active']), h('span', { class: 'k' }, [h('i', { class: 'e' }), 'Expired']),
      h('span', { class: 'k' }, [h('i', { class: 'u' }), 'Date unknown']), h('span', { class: 'k' }, [h('i', { class: 'now' }), 'Today'])]));
    var ticks = []; for (var y = Y0; y <= Y1; y += 5) ticks.push(h('span', { class: (y === Y0 ? 'first' : y >= Y1 - 1 ? 'last' : '') + (Math.abs(y - NOW) < 3 ? ' now' : ''), style: 'left:' + x(y) + '%', text: String(y) }));
    w.appendChild(h('div', { class: 'cpc-tl-ax', 'aria-hidden': 'true' }, [h('span', { class: 'h', text: 'Cancel' }), h('span', { class: 't' }, ticks)]));
    var note = areaNote(); if (note) w.insertBefore(note, w.firstChild);
    var list = listed();
    if (!list.length) { w.appendChild(h('p', { class: 'cpc-empty', text: 'No cancels match these filters.' })); return; }
    var frag = document.createDocumentFragment();
    [list].forEach(function (g) {
      g.forEach(function (c) {
        var segs = tlSegs(c), lx = Math.min(x(segs[0][0]), 78);
        var b = h('button', { class: 'cpc-tlr', type: 'button', 'aria-current': S.id === c.id ? 'true' : null, 'aria-label': c.po + ', ' + label(c) + ', ' + stName(c) + ', ' + (c.run || 'dates unknown'),
          onclick: function () { select(c.id); } }, [
          h('span', { class: 'who' }, [h('img', { src: thumb(c), alt: '', loading: 'lazy', decoding: 'async', width: 46, height: 46 }),
            h('span', { class: 'nm' }, [h('strong', {}, [c.po, c.story ? h('span', { class: 'cpc-story in', text: 'Design story' }) : null]), h('small', { text: label(c) }), h('small', { class: 'pv', text: c.prov })])]),
          h('span', { class: 'tk', style: '--step:' + step }, [h('b', { style: 'left:' + x(NOW) + '%' })].concat(
            segs.map(function (q) { return h('i', { class: q[2], style: 'left:' + x(q[0]) + '%;width:' + Math.max(0.8, x(q[1]) - x(q[0])) + '%' }); }),
            [h('em', { style: 'left:' + lx + '%', text: c.run || runShort(c).replace('–', ' – ') })]))
        ]);
        b._id = c.id; frag.appendChild(b);
      });
    });
    w.appendChild(frag);
  }
  function markTimeline() {
    el.tlWrap.querySelectorAll('.cpc-tlr').forEach(function (n) { if (n._id === S.id) n.setAttribute('aria-current', 'true'); else n.removeAttribute('aria-current'); });
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
  /* fan-out: the smallest regular polygon whose dots and nickname labels do not overlap */
  var measureCtx = null;
  function textW(t) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = '500 12px "Helvetica Neue", Helvetica, Arial, sans-serif';
    return Math.ceil(measureCtx.measureText(t).width) + 18;
  }
  var RATIO = 1.7;
  function labelDir(dx, dy, k) { return Math.abs(dy) > Math.abs(dx) * (k || RATIO) ? (dy < 0 ? 'top' : 'bottom') : (dx < 0 ? 'left' : 'right'); }
  var LBL_H = 22, DOT = 10, GAP = 3, OFF = { right: [10, 0], left: [-10, 0], top: [0, -10], bottom: [0, 10] };
  function boxes(r, ws, k) {
    var n = ws.length, out = [];
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / n, x = r * Math.cos(a), y = r * Math.sin(a), d = labelDir(x, y, k), w = ws[i], b;
      out.push([x - DOT, y - DOT, x + DOT, y + DOT]);
      if (d === 'right') b = [x + 10, y - LBL_H / 2, x + 10 + w, y + LBL_H / 2];
      else if (d === 'left') b = [x - 10 - w, y - LBL_H / 2, x - 10, y + LBL_H / 2];
      else if (d === 'top') b = [x - w / 2, y - 10 - LBL_H, x + w / 2, y - 10];
      else b = [x - w / 2, y + 10, x + w / 2, y + 10 + LBL_H];
      out.push(b);
    }
    return out;
  }
  function clashes(bx) {
    for (var i = 0; i < bx.length; i++) for (var j = i + 1; j < bx.length; j++) {
      if ((i >> 1) === (j >> 1)) continue; // a dot and its own label
      var p = bx[i], q = bx[j];
      if (p[0] < q[2] + GAP && q[0] < p[2] + GAP && p[1] < q[3] + GAP && q[1] < p[3] + GAP) return true;
    }
    return false;
  }
  function fanOut(n, c) {
    var kids = (cluster && cluster._cpcKids) || [], ws = [];
    for (var i = 0; i < n; i++) { var m = kids[i], cc = m && byId[m.options.cpcId]; ws.push(cc ? textW(label(cc)) : 80); }
    var r0 = Math.max(30, n > 1 ? (DOT + GAP / 2) / Math.sin(Math.PI / n) : 30), best = null;
    // try a few rules for which dots get labels above/below versus beside them; keep whichever packs tightest
    [0.45, 0.7, 1, 1.4, 1.7, 2.4, 3.5, 1e6].forEach(function (k) {
      var r = r0; while (r < 900 && clashes(boxes(r, ws, k))) r += 2;
      if (!best || r < best.r) best = { r: r, k: k };
    });
    var r = best.r; if (cluster) cluster._cpcRatio = best.k;
    var out = [];
    for (i = 0; i < n; i++) { var a = -Math.PI / 2 + i * 2 * Math.PI / n; out.push(L.point(c.x + r * Math.cos(a), c.y + r * Math.sin(a))); }
    return out;
  }
  function initMap() {
    if (!L.MarkerCluster.prototype._cpcPatched) {
      var orig = L.MarkerCluster.prototype.spiderfy;
      L.MarkerCluster.prototype.spiderfy = function () { this._group._cpcKids = this.getAllChildMarkers(null, true); return orig.apply(this, arguments); };
      L.MarkerCluster.prototype._cpcPatched = true;
    }
    map = L.map(el.map, { minZoom: 2, maxZoom: 19, zoomSnap: 0.25, worldCopyJump: true, scrollWheelZoom: false }).setView([58, -96], 3);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    map.on('click', function () { map.scrollWheelZoom.enable(); });
    var Near = L.Control.extend({ options: { position: 'topright' }, onAdd: function () {
      var b = L.DomUtil.create('button', 'cpc-near');
      b.type = 'button'; b.title = 'Jump to where you are'; b.setAttribute('aria-label', 'Near me: jump the map to where you are');
      b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8-8 18-2-8z"/></svg><span>Near me</span>';
      L.DomEvent.disableClickPropagation(b); L.DomEvent.on(b, 'click', function (e) { L.DomEvent.preventDefault(e); locate(); });
      el.nearB = b; return b; } });
    map.addControl(new Near());
    cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 44, spiderfyOnMaxZoom: true, spiderfyShapePositions: function (n, c) { return fanOut(n, c); }, spiderLegPolylineOptions: { weight: 1.5, color: '#1A1D23', opacity: 0.45 },
      iconCreateFunction: function (cl) {
        var ms = cl.getAllChildMarkers(), n = ms.length, e = ms.filter(function (m) { return m.options.cpcExp; }).length, d = Math.round(30 + Math.sqrt(n) * 4);
        return L.divIcon({ html: '<div class="cpc-cluster' + (e > n - e ? ' expired' : '') + '" style="width:' + d + 'px;height:' + d + 'px" title="' + (n - e) + ' active, ' + e + ' expired">' + n + '</div>', className: '', iconSize: [d, d] });
      } });
    D.forEach(function (c) {
      var m = L.marker([c.lat, c.lng], { title: c.po + ' — ' + label(c), alt: c.po, icon: pin(c, false), keyboard: true, cpcExp: expired(c), cpcId: c.id });
      m.on('click', function () { select(c.id, true); }); markers[c.id] = m;
    });
    cluster.on('spiderfied', function (e) {
      var o = map.latLngToLayerPoint(e.cluster.getLatLng());
      e.markers.forEach(function (m) {
        var p = map.latLngToLayerPoint(m.getLatLng()), dir = labelDir(p.x - o.x, p.y - o.y, cluster._cpcRatio);
        m._sp = true; if (m.getTooltip()) m.unbindTooltip();
        m.bindTooltip(label(byId[m.options.cpcId]), { permanent: true, direction: dir, offset: OFF[dir], className: 'cpc-label' });
      });
    });
    cluster.on('unspiderfied', function (e) { e.markers.forEach(function (m) { m._sp = false; m.unbindTooltip(); }); });
    cluster.on('animationend', labels);
    map.addLayer(cluster);
    map.on('moveend', debounce(function () {
      if (S.view === 'map') { var b = map.getBounds(), r = function (v) { return Math.round(v * 1e4) / 1e4; };
        S.area = [r(b.getSouth()), r(b.getWest()), r(b.getNorth()), r(b.getEast())]; writeHash(); }
      renderStrip(); labels(); renderFilters(); }, 120));
    leafletReady = true;
    if (S.area && !needFit) { renderMap(false); map.fitBounds([[S.area[0], S.area[1]], [S.area[2], S.area[3]]], { animate: false }); } else renderMap(true);
    needFit = false; halo();
  }
  function labels() {
    if (!leafletReady) return;
    D.forEach(function (c) { var m = markers[c.id]; if (!m._sp && m.getTooltip()) m.unbindTooltip(); });
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
    el.stripT.textContent = inView.length ? inView.length + (inView.length === 1 ? ' cancel' : ' cancels') + ' in this part of the map' : 'No cancels in this part of the map. Zoom out or move the map.';
    el.strip.innerHTML = ''; if (!S.strip) return;
    var frag = document.createDocumentFragment(); inView.slice(0, 40).forEach(function (c) { frag.appendChild(card(c)); }); el.strip.appendChild(frag);
  }

  /* ---------- detail ---------- */
  function select(id, fromMap) {
    var prev = S.id; S.id = id || '';
    if (leafletReady) { if (prev && markers[prev]) markers[prev].setIcon(pin(byId[prev], false)); if (id && markers[id]) markers[id].setIcon(pin(byId[id], true)); }
    renderDetail(); writeHash();
    root.querySelectorAll('.cpc-card[aria-current]').forEach(function (n) { n.removeAttribute('aria-current'); });
    root.querySelectorAll('.cpc-card').forEach(function (n) { if (n._id === id) n.setAttribute('aria-current', 'true'); });
    if (S.view === 'gallery') renderGallery(); else if (S.view === 'timeline') markTimeline(); else renderStrip();
    halo();
  }
  var haloM = null;
  function halo() {
    if (!leafletReady) return;
    if (haloM) { map.removeLayer(haloM); haloM = null; }
    var c = byId[S.id]; if (!c) return;
    haloM = L.marker([c.lat, c.lng], { interactive: false, keyboard: false, zIndexOffset: 2000,
      icon: L.divIcon({ html: '<div class="cpc-halo ' + st(c) + '"></div>', className: '', iconSize: [40, 40], iconAnchor: [20, 20] }) }).addTo(map);
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
  function versions(c) {
    var pos = {}, q = [c.id]; pos[c.id] = 0;
    while (q.length) { var x = byId[q.shift()], p = pos[x.id];
      (x.prev || []).forEach(function (i) { if (byId[i] && pos[i] == null) { pos[i] = p - 1; q.push(i); } });
      (x.next || []).forEach(function (i) { if (byId[i] && pos[i] == null) { pos[i] = p + 1; q.push(i); } }); }
    return Object.keys(pos).map(function (i) { return byId[i]; }).sort(function (a, b) { return pos[a.id] - pos[b.id] || (a.s || 0) - (b.s || 0); });
  }
  function coords(c) { return Math.abs(c.lat).toFixed(4) + '°' + (c.lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(c.lng).toFixed(4) + '°' + (c.lng < 0 ? 'W' : 'E'); }
  function field(k, v, cls) { return v == null || v === '' ? null : h('div', { class: 'cpc-f ' + (cls || '') }, [h('span', { class: 'k', text: k }), h('span', { class: 'v' }, Array.isArray(v) ? v : [String(v)])]); }
  function renderDetail() {
    var c = byId[S.id], d = el.detail;
    el.body.classList.toggle('has-detail', !!c); d.hidden = !c; d.innerHTML = '';
    if (!c) { if (map) setTimeout(function () { map.invalidateSize({ pan: false }); renderStrip(); }, 0); return; }
    d.className = 'cpc-detail ' + st(c);
    var span = Y1 - Y0, s = c.s || Y0, e = c.e || (c.open ? NOW : Y1), fuzzy = !c.s || (!c.e && !c.open);
    var kids = [
      h('button', { class: 'x', type: 'button', 'aria-label': 'Close', text: '×', onclick: function () { select(''); } }),
      h('button', { class: 'big', type: 'button', 'aria-label': 'Enlarge image', onclick: function () { lightbox(c); } }, [h('img', { src: full(c), alt: c.design || c.po, width: 600, height: 600 })]),
      h('div', { class: 'cpc-head' }, [
        h('div', { class: 'l' }, [h('h2', { text: c.po }), c.nick ? h('div', { class: 'nick', text: '“' + cap(c.nick) + '”' }) : null]),
        h('div', { class: 'r' }, [h('div', { class: 'cpc-addr', text: c.addr || [c.city, c.prov].join(', ') }), me ? h('div', { class: 'dist', text: Math.round(dist(me, c)) + ' km from you' }) : null])
      ]),
      h('div', { class: 'cpc-actions' }, [
        h('button', { class: 'cpc-btn go ' + st(c), type: 'button', text: 'Show on map', onclick: function () { showOnMap(c.id); } }),
        h('a', { class: 'cpc-btn', href: 'https://www.google.com/maps/search/?api=1&query=' + c.lat + ',' + c.lng, target: '_blank', rel: 'noopener', text: 'Directions' }),
        cmpBtn(c, false)
      ]),
      h('div', { class: 'cpc-run' }, [
        h('div', { class: 'lab' }, [h('span', { class: 'k', text: 'Run dates' }), h('span', { class: 'v', text: c.run || 'Unknown' })]),
        h('div', { class: 'tr' }, [
          h('i', { class: st(c) + (fuzzy ? ' fuzzy' : ''), style: 'left:' + ((s - Y0) / span * 100) + '%;width:' + Math.max(2, (e - s) / span * 100) + '%' }),
          h('b', { style: 'left:' + ((NOW - Y0) / span * 100) + '%', title: 'Today' })
        ]),
        h('div', { class: 'ax' }, [h('span', { text: String(Y0) }), h('span', { text: fuzzy ? 'striped = date unknown' : 'line = today' }), h('span', { text: String(Y1) })])
      ]),
      !expired(c) ? h('p', { class: 'cpc-howto' }, [ext('https://canadacancel.wordpress.com/2026/11/24/how-to-collect-canadian-pictorial-cancels-by-mail/', 'How to request this cancel by mail →'), ' · ', h('span', { lang: 'fr' }, [ext('https://canadacancel.wordpress.com/2026/11/25/comment-collectionner-obliterations-illustrees-par-la-poste/', 'en français')])]) : null,
      c.page ? h('p', { class: 'cpc-howto' }, [h('a', { href: BASE + c.page, target: '_blank', rel: 'noopener', text: 'Page for this cancel →' })]) : null,
      c.story ? h('a', { class: 'cpc-storylink', href: c.story, target: '_blank', rel: 'noopener' }, [h('span', { class: 'cpc-story', text: 'Design story' }), h('span', { text: 'Read the design story →' })]) : null,
      h('div', { class: 'cpc-fields' }, [
        field('Status', [h('span', { class: 'dot ' + st(c) }), stName(c)], 'st-' + st(c)),
        field('Colour', c.ink ? [h('span', { class: 'swatch', style: 'background:' + (INK[c.ink] || '#888') }), c.ink] : '—'),
        field('Designer', c.designer || 'Unknown'),
        field('Coordinates', coords(c), 'nowrap'),
        field('Design', c.design || '—', 'wide'),
        field('Notes', c.notes, 'wide'),
        c.tags ? h('div', { class: 'cpc-f wide' }, [h('span', { class: 'k', text: 'Tags' }), h('span', { class: 'cpc-chips' }, c.tags.map(function (t) {
          return h('button', { class: 'cpc-chip', type: 'button', text: t, onclick: function () { S.tag = [t.toLowerCase()]; S.id = ''; renderDetail(); go(true); } }); }))]) : null
      ])
    ];
    var chain = versions(c), ver = chain.length > 1 ? chain.map(function (o, i) {
      var lab = 'Version ' + (i + 1) + ' of ' + chain.length;
      return o.id === c.id ? h('div', { class: 'cpc-rel cur' }, [h('img', { src: thumb(o), alt: '', width: 48, height: 48 }), h('span', {}, [label(o), h('small', { text: lab + ' · this one' })])]) : rel(o, lab);
    }) : [];
    if (ver.length) kids.push(h('div', { class: 'cpc-sec' }, [h('h3', { class: 'cpc-h', text: 'Versions of this cancel' })].concat(ver)));
    var linked = chain.map(function (o) { return o.id; });
    var same = D.filter(function (o) { return o.id !== c.id && linked.indexOf(o.id) < 0 && Math.abs(o.lat - c.lat) < 1e-4 && Math.abs(o.lng - c.lng) < 1e-4; });
    if (same.length) kids.push(h('div', { class: 'cpc-sec' }, [h('h3', { class: 'cpc-h', text: 'Also at this post office' })].concat(same.map(function (o) { return rel(o, o.po); }))));
    kids.push(h('div', { class: 'cpc-sec' }, [h('button', { class: 'cpc-btn', type: 'button', text: 'Copy link to this cancel', onclick: function () {
      var u = location.href; if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { toast('Link copied'); }); else prompt('Copy this link', u); } })]));
    kids.forEach(function (k) { if (k) d.appendChild(k); });
    d.scrollTop = 0;
    if (map) setTimeout(function () { map.invalidateSize({ pan: false }); renderStrip(); }, 0);
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
    S.view = v; el.mapWrap.hidden = v !== 'map'; el.galWrap.hidden = v !== 'gallery'; el.tlWrap.hidden = v !== 'timeline';
    el.tabMap.setAttribute('aria-pressed', v === 'map'); el.tabGal.setAttribute('aria-pressed', v === 'gallery'); el.tabTl.setAttribute('aria-pressed', v === 'timeline');
    if (v === 'map') { if (!leafletReady) loadLeaflet(initMap); else setTimeout(function () { map.invalidateSize(); renderMap(needFit); needFit = false; }, 0); }
    else if (v === 'timeline') renderTimeline();
    else renderGallery();
    if (D.length) { renderFilters(); paintCount(); }
    writeHash();
  }
  var meM = null;
  function locate() {
    if (!navigator.geolocation) return toast('Location is not available in this browser');
    if (el.nearB) el.nearB.classList.add('busy');
    navigator.geolocation.getCurrentPosition(function (p) {
      if (el.nearB) el.nearB.classList.remove('busy');
      me = { lat: p.coords.latitude, lng: p.coords.longitude }; renderDetail();
      if (leafletReady) {
        if (meM) map.removeLayer(meM);
        meM = L.marker([me.lat, me.lng], { interactive: false, keyboard: false, zIndexOffset: 3000,
          icon: L.divIcon({ html: '<div class="cpc-me"></div>', className: '', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);
        map.setView([me.lat, me.lng], 7);
      }
    }, function () { if (el.nearB) el.nearB.classList.remove('busy'); toast('Could not get your location'); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }
  /* the selection: what is on screen now — filters, plus the visible part of the map in map view */
  function selection() {
    if (S.view === 'map' && leafletReady) { var b = map.getBounds(); return filtered.filter(function (c) { return b.contains([c.lat, c.lng]); }); }
    return listed();
  }
  function paintDl() {
    var n = selection().length;
    el.dlHead.textContent = n + (n === 1 ? ' cancel' : ' cancels') + (S.view === 'map' ? ' in this part of the map' : ' matching your filters');
  }
  function fname(c) { return (c.prov + '/' + c.po + (c.nick ? ' - ' + c.nick : '') + ' - ' + c.id.slice(-5)).replace(/[\\:*?"<>|]+/g, '').replace(/\s+/g, ' ') + '.jpg'; }
  function table(withFile) {
    var cols = [['Post Office', 'po'], ['City', 'city'], ['Province', 'prov'], ['Status', 'status'], ['Colour', 'ink'], ['Run Dates', 'run'], ['Design', 'design'], ['Nickname', 'nick'], ['Designer', 'designer'], ['Tags', 'tags'], ['Latitude', 'lat'], ['Longitude', 'lng'], ['Address', 'addr'], ['Notes', 'notes'], ['Design story', 'story']];
    var q = function (v) { v = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v); return '"' + v.replace(/"/g, '""').replace(/\n/g, ', ') + '"'; };
    // header names stay unquoted: a quote right after the byte-order mark makes Google My Maps reject the file
    var head = cols.map(function (c) { return c[0]; }).concat([withFile ? 'Image file' : 'Image link']).join(',');
    return '\ufeff' + [head].concat(selection().map(function (r) {
      return cols.map(function (c) { return q(c[1] === 'status' ? stName(r) : r[c[1]]); }).concat([q(withFile ? 'images/' + fname(r) : full(r))]).join(',');
    })).join('\r\n');
  }
  function save(blob, name) { var a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove(); }
  /* KML for Google My Maps / Google Earth: gx_media_links in ExtendedData makes My Maps show the image in each pin's info box (a CSV column does not) */
  function kml() {
    var sel = selection(); if (!sel.length) return toast('No cancels to download');
    var x = function (v) { return String(v == null ? '' : Array.isArray(v) ? v.join(', ') : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var cols = [['Post Office', 'po'], ['Nickname', 'nick'], ['Status', 'status'], ['Run Dates', 'run'], ['Colour', 'ink'], ['Design', 'design'], ['Designer', 'designer'], ['Tags', 'tags'], ['City', 'city'], ['Province', 'prov'], ['Address', 'addr'], ['Notes', 'notes'], ['Design story', 'story']];
    var icon = 'https://www.gstatic.com/mapspro/images/stock/503-wht-blank_maps.png';
    var style = function (id, c) { return '<Style id="' + id + '"><IconStyle><color>' + c + '</color><scale>1</scale><Icon><href>' + icon + '</href></Icon></IconStyle></Style>'; };
    var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
      '<name>' + x("Canada's Pictorial Cancels (" + sel.length + ')') + '</name>', style('active', 'ff33c920'), style('expired', 'ff481de1')];
    sel.forEach(function (c) {
      // same shape as a Google My Maps export: the image in the description as HTML, and again in gx_media_links
      out.push('<Placemark><name>' + x(c.po + (c.nick ? ' \u2013 ' + cap(c.nick) : '')) + '</name>' +
        '<description><![CDATA[<img src="' + full(c) + '" height="200" width="auto" />]]></description>' +
        '<styleUrl>#' + st(c) + '</styleUrl><ExtendedData>' +
        cols.map(function (k) { var v = k[1] === 'status' ? stName(c) : c[k[1]]; return v == null || v === '' ? '' : '<Data name="' + x(k[0]) + '"><value>' + x(v) + '</value></Data>'; }).join('') +
        '<Data name="gx_media_links"><value><![CDATA[' + full(c) + ']]></value></Data></ExtendedData>' +
        '<Point><coordinates>' + c.lng + ',' + c.lat + ',0</coordinates></Point></Placemark>');
    });
    out.push('</Document></kml>');
    save(new Blob([out.join('\n')], { type: 'application/vnd.google-earth.kml+xml' }), 'pictorial-cancels.kml');
  }
  function csv() { if (!selection().length) return toast('No cancels to download'); save(new Blob([table(false)], { type: 'text/csv' }), 'pictorial-cancels.csv'); }
  function zip(kind) {
    var sel = selection(), n = sel.length, mb = Math.round(n * (kind === 'full' ? 0.14 : 0.024));
    if (!n) return toast('No cancels to download');
    if (n > 60 && !confirm('Download ' + n + ' cancels with ' + (kind === 'full' ? 'full-size' : 'small') + ' images? About ' + Math.max(1, mb) + ' MB.')) return;
    function go2() {
      var z = new JSZip(), list = sel.slice(), done = 0, i = 0, run = 0, failed = 0;
      z.file('pictorial-cancels.csv', table(true));
      toast('Preparing ' + n + ' images…');
      return new Promise(function (res) {
        function next() {
          while (run < 6 && i < list.length) { (function (c) { run++; i++;
            fetch(kind === 'full' ? full(c) : thumb(c)).then(function (r) { if (!r.ok) throw 0; return r.blob(); })
              .then(function (b) { z.file('images/' + fname(c), b, { binary: true }); }, function () { failed++; })
              .then(function () { run--; done++; el.count.textContent = 'Preparing images ' + done + ' / ' + n + '…'; if (done === n) res(); else next(); });
          })(list[i]); }
        }
        next();
      }).then(function () { return z.generateAsync({ type: 'blob', compression: 'STORE' }); })
        .then(function (b) { save(b, 'pictorial-cancels' + (kind === 'full' ? '' : '-small') + '.zip'); update(); if (failed) toast(failed + ' images could not be included'); });
    }
    if (window.JSZip) go2(); else { var sc = h('script', { src: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js' }); sc.onload = go2; sc.onerror = function () { toast('Could not load the ZIP tool'); }; document.head.appendChild(sc); }
  }

  /* ---------- update cycle ---------- */
  function update(fit) {
    filtered = sortList(D.filter(function (c) { return match(c); }));
    el.count.innerHTML = '';
    paintCount();
    el.yOn.checked = !!S.ya; el.yDual.classList.toggle('off', !S.ya);
    if (S.ya) { el.ya.value = S.ya; el.yb.value = S.yb; } paintYears();
    paintSort();
    renderFilters();
    if (S.view === 'gallery') renderGallery(); else if (S.view === 'timeline') renderTimeline(); else { renderMap(fit || needFit); if (leafletReady) needFit = false; }
    writeHash();
  }

  /* ---------- boot ---------- */
  readHash(); build();
  el.count.textContent = 'Loading cancels…';
  fetch(BASE + 'data.json?t=' + Math.floor(Date.now() / 36e5)).then(function (r) { return r.json(); }).then(function (j) {
    D = j.cancels; updated = j.updated;
    var nP = {}; D.forEach(function (c) { nP[c.prov] = 1; });
    el.sub.textContent = D.length + ' postmarks from ' + Object.keys(nP).length + ' provinces and territories';
    D.forEach(function (c, i) { c._o = i; byId[c.id] = c; c._t = (c.tags || []).map(function (t) { return t.toLowerCase(); });
      c._s = [c.po, c.city, c.prov, c.pc, c.design, c.nick, c._t.join(' '), c.designer, c.ink, c.notes].join(' ').toLowerCase(); });

    var pg = S.page; setView(S.view); update(true); if (pg > 1 && S.view === 'gallery') { S.page = pg; renderGallery(); writeHash(); }
    S.cmp = S.cmp.filter(function (id) { return byId[id]; }); renderTray(); if (S.cmpOpen) renderCompare();
    if (S.id && byId[S.id]) select(S.id); else S.id = '';
    if (S.about) renderAbout();
  }).catch(function () { el.count.textContent = 'The cancel list could not be loaded. Please try again later.'; });
  window.addEventListener('hashchange', function () { var id = S.id, ar = S.area && S.area.join(); readHash(); el.search.value = S.q; setView(S.view);
    var moved = S.area && S.area.join() !== ar; update(!S.area);
    if (moved && leafletReady && S.view === 'map') map.fitBounds([[S.area[0], S.area[1]], [S.area[2], S.area[3]]], { animate: false }); if (S.id !== id) select(S.id); renderTray(); if (S.cmpOpen) renderCompare(); else if (!el.cmp.hidden) { el.cmp.hidden = true; document.documentElement.style.overflow = ''; } if (S.about) renderAbout(); else if (!el.about.hidden) closeAbout(); });
})();
