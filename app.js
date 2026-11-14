/* Canada's Pictorial Cancels — single-file app. Mounts into #cpc-app. */
(function () {
  'use strict';
  var script = document.currentScript;
  var BASE = (script && script.src) ? script.src.replace(/[^/]*$/, '') : './';
  var root = document.getElementById('cpc-app');
  if (!root) return;
  var NOW = new Date().getFullYear();
  var PAGE = 60;
  var THEMES = [
    ['Animals', ['animal', 'mammal', 'wildlife', 'fish', 'insect', 'reptile', 'canine']],
    ['Birds', ['bird', 'bird of prey', 'eagle']],
    ['Buildings', ['architecture', 'building', 'post office', 'lighthouse', 'church']],
    ['Ships, trains, planes', ['transportation', 'vessel', 'ship', 'aircraft', 'train', 'railway']],
    ['Nature', ['nature', 'plant', 'tree', 'landscape', 'mountain', 'water', 'river', 'leaf', 'flower']],
    ['History', ['history', 'postal history', 'anniversary']],
    ['Festivals', ['festivity', 'festival', 'celebration']],
    ['Art and music', ['art', 'music', 'dance', 'culture']],
    ['Sport', ['sport']],
    ['First Nations', ['first nation']],
    ['Dinosaurs and fossils', ['dinosaur', 'fossil']],
    ['Haunted Canada', ['haunted canada', 'haunted']]
  ];
  var INK = { Black: '#1A1A1A', Red: '#D52B1E', Blue: '#1F4FBF', Green: '#1B7F4B', Pink: '#E86AA6' };
  var S = { view: 'map', q: '', act: true, ret: true, prov: '', theme: '', ink: '', year: null, soon: false, sort: 'place', id: '' };
  var D = [], byId = {}, updated = '', shown = PAGE, me = null;
  var map, cluster, markers = {}, leafletReady = false, filtered = [];

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
  function retired(c) { return c.status !== 'Active'; }
  function title(c) { var m = /"([^"]+)"/.exec(c.design || ''); return c.nick && !/version|new|^\d/i.test(c.nick) ? cap(c.nick) : (m ? m[1] : cap((c.design || c.po).split(';')[0])); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function runShort(c) { return (c.s || '?') + '–' + (c.e || (c.open ? 'now' : '?')); }
  function dist(a, b) {
    var R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function inUse(c, y) {
    if (c.s && c.s > y) return false;
    if (c.e && c.e < y) return false;
    if (retired(c) && !c.e && y >= NOW) return false;
    return true;
  }
  function toast(msg) {
    var t = h('div', { class: 'cpc cpc-toast', role: 'status', text: msg });
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2200);
  }

  /* ---------- state <-> URL ---------- */
  function writeHash() {
    var p = new URLSearchParams();
    if (S.view !== 'map') p.set('view', S.view);
    if (S.q) p.set('q', S.q);
    if (!S.act) p.set('active', '0');
    if (!S.ret) p.set('retired', '0');
    ['prov', 'theme', 'ink', 'id'].forEach(function (k) { if (S[k]) p.set(k, S[k]); });
    if (S.year) p.set('year', S.year);
    if (S.soon) p.set('soon', '1');
    if (S.sort !== 'place') p.set('sort', S.sort);
    var s = p.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }
  function readHash() {
    var p = new URLSearchParams(location.hash.replace(/^#/, ''));
    S.view = p.get('view') === 'gallery' ? 'gallery' : 'map';
    S.q = p.get('q') || ''; S.act = p.get('active') !== '0'; S.ret = p.get('retired') !== '0';
    S.prov = p.get('prov') || ''; S.theme = p.get('theme') || ''; S.ink = p.get('ink') || '';
    S.year = parseInt(p.get('year'), 10) || null; S.soon = p.get('soon') === '1';
    S.sort = p.get('sort') || 'place'; S.id = p.get('id') || '';
  }

  /* ---------- filtering ---------- */
  function match(c, skip) {
    if (retired(c) ? !S.ret : !S.act) return false;
    if (skip !== 'prov' && S.prov && c.prov !== S.prov) return false;
    if (S.ink && c.ink !== S.ink) return false;
    if (S.soon && !(c.status === 'Active' && c.e && c.e <= NOW + 1)) return false;
    if (S.year && !inUse(c, S.year)) return false;
    if (S.theme) {
      var set = (THEMES.filter(function (t) { return t[0] === S.theme; })[0] || [0, []])[1];
      if (!(c.tags || []).some(function (t) { return set.indexOf(t.toLowerCase()) > -1; })) return false;
    }
    if (S.q) {
      var words = S.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < words.length; i++) if (c._s.indexOf(words[i]) < 0) return false;
    }
    return true;
  }
  function sortList(list) {
    var f = {
      place: function (a, b) { return a._o - b._o; },
      added: function (a, b) { return a.added < b.added ? 1 : a.added > b.added ? -1 : a._o - b._o; },
      oldest: function (a, b) { return (a.s || 9999) - (b.s || 9999) || a._o - b._o; },
      ending: function (a, b) { return (a.e || 9999) - (b.e || 9999) || a._o - b._o; },
      near: function (a, b) { return a._d - b._d; }
    }[S.sort] || null;
    if (S.sort === 'near' && me) list.forEach(function (c) { c._d = dist(me, c); });
    return f ? list.slice().sort(f) : list;
  }

  /* ---------- skeleton ---------- */
  var el = {};
  function build() {
    root.className = 'cpc' + (root.hasAttribute('data-breakout') ? ' cpc--breakout' : '');
    root.innerHTML = '';
    el.search = h('input', { type: 'search', placeholder: 'Search town, post office or design', 'aria-label': 'Search', value: S.q,
      oninput: debounce(function () { S.q = el.search.value.trim(); shown = PAGE; update(); }, 160) });
    el.tabMap = h('button', { class: 'cpc-tab', type: 'button', text: 'Map', onclick: function () { setView('map'); } });
    el.tabGal = h('button', { class: 'cpc-tab', type: 'button', text: 'Gallery', onclick: function () { setView('gallery'); } });
    var top = h('header', { class: 'cpc-top' }, [
      h('h1', { class: 'cpc-title', text: "Canada's Pictorial Cancels" }),
      h('label', { class: 'cpc-search' }, [svg('M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-3.5-3.5'), el.search]),
      h('nav', { class: 'cpc-tabs', 'aria-label': 'Views' }, [el.tabMap, el.tabGal])
    ]);
    el.count = h('span', { class: 'cpc-count', role: 'status' });
    el.yearOn = h('input', { type: 'checkbox', onchange: function () { S.year = el.yearOn.checked ? +el.yearR.value : null; shown = PAGE; update(); } });
    el.yearR = h('input', { type: 'range', min: 2001, max: 2036, step: 1, value: NOW, 'aria-label': 'Year',
      oninput: function () { el.yearO.textContent = el.yearR.value; if (el.yearOn.checked) { S.year = +el.yearR.value; shown = PAGE; update(); } } });
    el.yearO = h('output', { class: 'mono' });
    el.sort = h('select', { class: 'cpc-btn', 'aria-label': 'Sort', onchange: function () {
      if (el.sort.value === 'near' && !me) { el.sort.value = S.sort; return locate(); }
      S.sort = el.sort.value; shown = PAGE; update(); } },
      [['place', 'Sort: province, town'], ['added', 'Sort: newest added'], ['oldest', 'Sort: oldest first'], ['ending', 'Sort: ending soonest'], ['near', 'Sort: nearest to me']]
        .map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    var bar = h('div', { class: 'cpc-bar' }, [
      h('button', { class: 'cpc-btn cpc-filtertoggle', type: 'button', text: 'Filters', onclick: function () { el.filters.classList.toggle('open'); } }),
      el.count,
      h('div', { class: 'cpc-year' }, [h('label', {}, [el.yearOn, 'In use during']), el.yearO, el.yearR]),
      el.sort,
      h('button', { class: 'cpc-btn', type: 'button', text: 'Near me', onclick: locate }),
      h('button', { class: 'cpc-btn', type: 'button', text: 'Download list', title: 'Download the cancels shown as a CSV file', onclick: csv })
    ]);
    el.filters = h('aside', { class: 'cpc-filters', 'aria-label': 'Filters' });
    el.mapWrap = h('div', {}, [
      el.map = h('div', { class: 'cpc-map', role: 'application', 'aria-label': 'Map of post offices with pictorial cancels' }),
      el.stripH = h('div', { class: 'cpc-strip-h' }),
      el.strip = h('div', { class: 'cpc-strip' })
    ]);
    el.galWrap = h('div', {}, [el.grid = h('div', { class: 'cpc-grid' }), el.more = h('div', { class: 'cpc-more' })]);
    el.main = h('main', {}, [el.mapWrap, el.galWrap]);
    el.detail = h('aside', { class: 'cpc-detail', 'aria-label': 'Selected cancel', hidden: true });
    el.body = h('div', { class: 'cpc-body' }, [el.filters, el.main, el.detail]);
    root.appendChild(top); root.appendChild(bar); root.appendChild(el.body);
  }
  function svg(d) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', 18); s.setAttribute('height', 18); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', '#5A6270'); s.setAttribute('stroke-width', 2); s.setAttribute('stroke-linecap', 'round');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p); return s;
  }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  /* ---------- filter column ---------- */
  function chip(label, on, fn, cls, lead) {
    return h('button', { class: 'cpc-chip ' + (cls || ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: fn }, [lead, label]);
  }
  function renderFilters() {
    var base = D.filter(function (c) { var a = S.act, r = S.ret; S.act = S.ret = true; var ok = match(c); S.act = a; S.ret = r; return ok; });
    var nA = base.filter(function (c) { return !retired(c); }).length, nR = base.length - nA;
    var f = el.filters; f.innerHTML = '';
    f.appendChild(h('div', {}, [h('h2', { class: 'cpc-h', text: 'Status' }), h('div', { class: 'cpc-chips' }, [
      chip('Active · ' + nA, S.act, function () { S.act = !S.act; if (!S.act && !S.ret) S.ret = true; go(); }, 'st active', h('span', { class: 'dot' })),
      chip('Retired · ' + nR, S.ret, function () { S.ret = !S.ret; if (!S.act && !S.ret) S.act = true; go(); }, 'st retired', h('span', { class: 'dot retired' })),
      chip('Ending by ' + (NOW + 1), S.soon, function () { S.soon = !S.soon; go(); })
    ])]));
    f.appendChild(h('div', {}, [h('h2', { class: 'cpc-h', text: 'Theme' }), h('div', { class: 'cpc-chips' },
      THEMES.map(function (t) { return chip(t[0], S.theme === t[0], function () { S.theme = S.theme === t[0] ? '' : t[0]; go(); }); }))]));
    f.appendChild(h('div', {}, [h('h2', { class: 'cpc-h', text: 'Ink colour' }), h('div', { class: 'cpc-chips' },
      Object.keys(INK).map(function (k) { return chip(k, S.ink === k, function () { S.ink = S.ink === k ? '' : k; go(); }, '', h('span', { class: 'swatch', style: 'background:' + INK[k] })); }))]));
    var provs = {}, max = 1;
    D.forEach(function (c) { provs[c.prov] = provs[c.prov] || [0, 0]; });
    D.forEach(function (c) { if (match(c, 'prov')) provs[c.prov][retired(c) ? 1 : 0]++; });
    Object.keys(provs).forEach(function (k) { max = Math.max(max, provs[k][0] + provs[k][1]); });
    f.appendChild(h('div', {}, [h('h2', { class: 'cpc-h', text: 'Province or territory' })].concat(
      Object.keys(provs).sort(function (a, b) { return (provs[b][0] + provs[b][1]) - (provs[a][0] + provs[a][1]) || a.localeCompare(b); }).map(function (k) {
        var a = provs[k][0], r = provs[k][1];
        return h('button', { class: 'cpc-prov', type: 'button', 'aria-pressed': S.prov === k ? 'true' : 'false',
          'aria-label': k + ': ' + a + ' active, ' + r + ' retired', onclick: function () { S.prov = S.prov === k ? '' : k; go(true); } }, [
          h('span', { class: 'n', text: k }),
          h('span', { class: 'bar' }, [h('i', { style: 'width:' + (a / max * 100) + '%' }), h('i', { style: 'width:' + (r / max * 100) + '%' })]),
          h('span', { class: 'c mono', text: String(a + r) })
        ]);
      }))));
    if (S.q || S.prov || S.theme || S.ink || S.year || S.soon || !S.act || !S.ret)
      f.appendChild(h('button', { class: 'cpc-clear', type: 'button', text: 'Clear all filters', onclick: function () {
        S.q = S.prov = S.theme = S.ink = ''; S.year = null; S.soon = false; S.act = S.ret = true; el.search.value = ''; go(true); } }));
  }
  function go(fit) { shown = PAGE; update(fit); }

  /* ---------- cards ---------- */
  function card(c) {
    var isNew = updated && (new Date(updated) - new Date(c.added)) < 60 * 864e5;
    return h('button', { class: 'cpc-card', type: 'button', 'aria-current': S.id === c.id ? 'true' : null, onclick: function () { select(c.id); } }, [
      isNew ? h('span', { class: 'cpc-new', text: 'NEW' }) : null,
      h('img', { class: 'im', src: thumb(c), alt: c.design || c.po, loading: 'lazy', decoding: 'async', width: 360, height: 360 }),
      h('span', { class: 'tx' }, [
        h('span', { class: 'r1' }, [h('span', { class: 'po', text: c.po }), h('span', { class: 'pc mono', text: c.pc })]),
        h('span', { class: 'de', text: c._d != null && S.sort === 'near' ? Math.round(c._d) + ' km away · ' + title(c) : title(c) }),
        h('span', { class: 'r3' }, [h('span', { class: 'dot' + (retired(c) ? ' retired' : '') }), retired(c) ? 'Retired' : 'Active', h('span', { class: 'mono', text: runShort(c) })])
      ])
    ]);
  }
  function renderGallery() {
    el.grid.innerHTML = ''; el.more.innerHTML = '';
    if (!filtered.length) { el.grid.appendChild(h('div', { class: 'cpc-empty', style: 'grid-column:1/-1', text: 'No cancels match these filters.' })); return; }
    var frag = document.createDocumentFragment();
    filtered.slice(0, shown).forEach(function (c) { frag.appendChild(card(c)); });
    el.grid.appendChild(frag);
    if (filtered.length > shown) el.more.appendChild(h('button', { class: 'cpc-btn', type: 'button',
      text: 'Show ' + Math.min(PAGE, filtered.length - shown) + ' more', onclick: function () { shown += PAGE; renderGallery(); } }));
  }

  /* ---------- map ---------- */
  function loadLeaflet(cb) {
    if (window.L && L.markerClusterGroup) return cb();
    var css = ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css'];
    css.forEach(function (u) { document.head.appendChild(h('link', { rel: 'stylesheet', href: u })); });
    var s1 = h('script', { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' });
    s1.onload = function () { var s2 = h('script', { src: 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js' }); s2.onload = cb; document.head.appendChild(s2); };
    document.head.appendChild(s1);
  }
  function initMap() {
    map = L.map(el.map, { minZoom: 2, maxZoom: 16, zoomSnap: 0.25, worldCopyJump: true, scrollWheelZoom: false }).setView([58, -96], 3);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    map.on('click', function () { map.scrollWheelZoom.enable(); });
    cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 44, spiderfyOnMaxZoom: true,
      iconCreateFunction: function (cl) { var n = cl.getChildCount(), d = Math.round(30 + Math.sqrt(n) * 4);
        return L.divIcon({ html: '<div class="cpc-cluster" style="width:' + d + 'px;height:' + d + 'px">' + n + '</div>', className: '', iconSize: [d, d] }); } });
    D.forEach(function (c) {
      var m = L.marker([c.lat, c.lng], { title: c.po + ' — ' + title(c), alt: c.po, icon: pin(c, false), keyboard: true });
      m.on('click', function () { select(c.id, true); }); markers[c.id] = m;
    });
    map.addLayer(cluster);
    map.on('moveend', debounce(renderStrip, 120));
    leafletReady = true; renderMap(true);
  }
  function pin(c, sel) {
    return L.divIcon({ html: '<div class="cpc-pin' + (retired(c) ? ' retired' : '') + (sel ? ' sel' : '') + '"></div>', className: '', iconSize: [16, 16], iconAnchor: [8, 8] });
  }
  function renderMap(fit) {
    if (!leafletReady) return;
    cluster.clearLayers();
    cluster.addLayers(filtered.map(function (c) { return markers[c.id]; }));
    if (fit && filtered.length && S.view === 'map') {
      var b = L.latLngBounds(filtered.map(function (c) { return [c.lat, c.lng]; }));
      map.fitBounds(b.pad(0.08), { maxZoom: 11, animate: false });
    }
    renderStrip();
  }
  function renderStrip() {
    if (!leafletReady || S.view !== 'map') return;
    var b = map.getBounds(), inView = filtered.filter(function (c) { return b.contains([c.lat, c.lng]); });
    el.stripH.textContent = inView.length ? inView.length + (inView.length === 1 ? ' cancel' : ' cancels') + ' in this part of the map' : 'No cancels in this part of the map. Zoom out or move the map.';
    el.strip.innerHTML = '';
    var frag = document.createDocumentFragment();
    inView.slice(0, 40).forEach(function (c) { frag.appendChild(card(c)); });
    el.strip.appendChild(frag);
  }

  /* ---------- detail ---------- */
  function select(id, fromMap) {
    var prev = S.id; S.id = id || '';
    if (leafletReady) { if (prev && markers[prev]) markers[prev].setIcon(pin(byId[prev], false)); if (id && markers[id]) markers[id].setIcon(pin(byId[id], true)); }
    renderDetail(); writeHash();
    root.querySelectorAll('.cpc-card[aria-current]').forEach(function (n) { n.removeAttribute('aria-current'); });
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
  function rel(c, label) {
    return h('button', { class: 'cpc-rel', type: 'button', onclick: function () { select(c.id); } }, [
      h('img', { src: thumb(c), alt: '', loading: 'lazy', width: 48, height: 48 }),
      h('span', {}, [title(c), h('small', { text: label + ' · ' + (retired(c) ? 'Retired' : 'Active') + ' · ' + runShort(c) })])
    ]);
  }
  function renderDetail() {
    var c = byId[S.id], d = el.detail;
    el.body.classList.toggle('has-detail', !!c); d.hidden = !c; d.innerHTML = '';
    if (!c) { if (map) setTimeout(function () { map.invalidateSize(); }, 0); return; }
    var lo = 2001, hi = 2036, span = hi - lo, s = c.s || lo, e = c.e || (c.open ? NOW : hi);
    var kids = [
      h('button', { class: 'x', type: 'button', 'aria-label': 'Close', text: '×', onclick: function () { select(''); } }),
      h('button', { class: 'big', type: 'button', 'aria-label': 'Enlarge image', onclick: function () { lightbox(c); } },
        [h('img', { src: full(c), alt: c.design || c.po, width: 600, height: 600 })]),
      h('div', {}, [h('h2', { text: title(c) }), h('div', { class: 'sub', text: c.po + ' · ' + [c.city, c.prov].filter(Boolean).join(', ') })]),
      c.design ? h('p', { text: c.design }) : null,
      h('div', { class: 'cpc-run' }, [
        h('div', { class: 'lab' }, [h('span', { text: 'Run dates' }), h('span', { class: 'mono', text: c.run || 'Unknown' })]),
        h('div', { class: 'tr' }, [
          h('i', { class: (retired(c) ? 'retired' : '') + (!c.s || (!c.e && !c.open) ? ' fuzzy' : ''), style: 'left:' + ((s - lo) / span * 100) + '%;width:' + Math.max(2, (e - s) / span * 100) + '%' }),
          h('b', { style: 'left:' + ((NOW - lo) / span * 100) + '%', title: 'Today' })
        ]),
        h('div', { class: 'ax mono' }, [h('span', { text: String(lo) }), h('span', { text: (!c.s || (!c.e && !c.open)) ? 'striped = date unknown' : 'line = today' }), h('span', { text: String(hi) })])
      ]),
      h('dl', { class: 'cpc-dl' }, [
        h('div', {}, [h('dt', { text: 'Status' }), h('dd', {}, [h('span', { class: 'dot' + (retired(c) ? ' retired' : '') }), retired(c) ? 'Retired' : 'Active'])]),
        c.ink ? h('div', {}, [h('dt', { text: 'Ink' }), h('dd', {}, [h('span', { class: 'swatch', style: 'background:' + (INK[c.ink] || '#888') }), c.ink])]) : null,
        c.designer && c.designer !== 'Unknown' ? h('div', {}, [h('dt', { text: 'Designer' }), h('dd', { text: c.designer })]) : null,
        c.w && c.h ? h('div', {}, [h('dt', { text: 'Size' }), h('dd', { text: String(c.w).replace(/mm/, '') + ' × ' + String(c.h).replace(/mm/, '') + ' mm' })]) : null
      ]),
      c.tags ? h('div', { class: 'cpc-chips' }, c.tags.map(function (t) {
        return h('button', { class: 'cpc-chip', type: 'button', text: t, onclick: function () { S.q = t; el.search.value = t; S.id = ''; renderDetail(); go(true); } }); })) : null
    ];
    var ver = (c.prev || []).map(function (i) { return byId[i] && rel(byId[i], 'Earlier version'); })
      .concat((c.next || []).map(function (i) { return byId[i] && rel(byId[i], 'Later version'); })).filter(Boolean);
    if (ver.length) kids.push(h('div', { class: 'cpc-sec' }, [h('h3', { class: 'cpc-h', text: 'Versions of this cancel' })].concat(ver)));
    var linked = (c.prev || []).concat(c.next || []);
    var same = D.filter(function (o) { return o.id !== c.id && linked.indexOf(o.id) < 0 && Math.abs(o.lat - c.lat) < 1e-4 && Math.abs(o.lng - c.lng) < 1e-4; });
    if (same.length) kids.push(h('div', { class: 'cpc-sec' }, [h('h3', { class: 'cpc-h', text: 'Also at this post office' })].concat(same.map(function (o) { return rel(o, o.po); }))));
    kids.push(h('div', { class: 'cpc-sec' }, [
      h('h3', { class: 'cpc-h', text: 'Post office' }),
      h('div', { class: 'cpc-addr', text: c.addr || [c.city, c.prov].join(', ') }),
      me ? h('div', { class: 'sub', text: Math.round(dist(me, c)) + ' km from you' }) : null,
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
    var box = h('div', { class: 'cpc cpc-lightbox', role: 'dialog', 'aria-label': 'Enlarged image' }, [
      h('img', { src: full(c), alt: c.design || c.po }), h('button', { type: 'button', 'aria-label': 'Close', text: '×' })]);
    function close() { box.remove(); document.removeEventListener('keydown', key); }
    function key(e) { if (e.key === 'Escape') close(); }
    box.addEventListener('click', close); document.addEventListener('keydown', key);
    document.body.appendChild(box); box.querySelector('button').focus();
  }

  /* ---------- actions ---------- */
  function setView(v) {
    S.view = v; el.mapWrap.hidden = v !== 'map'; el.galWrap.hidden = v !== 'gallery';
    el.tabMap.setAttribute('aria-pressed', v === 'map'); el.tabGal.setAttribute('aria-pressed', v === 'gallery');
    if (v === 'map') { if (!leafletReady) loadLeaflet(initMap); else { setTimeout(function () { map.invalidateSize(); renderMap(false); }, 0); } }
    else renderGallery();
    writeHash();
  }
  function locate() {
    if (!navigator.geolocation) return toast('Location is not available in this browser');
    navigator.geolocation.getCurrentPosition(function (p) {
      me = { lat: p.coords.latitude, lng: p.coords.longitude }; S.sort = 'near'; el.sort.value = 'near'; shown = PAGE; update();
      if (leafletReady && S.view === 'map') map.setView([me.lat, me.lng], 8);
      toast('Sorted by distance from you');
    }, function () { toast('Could not get your location'); }, { timeout: 8000 });
  }
  function csv() {
    var cols = [['Post Office', 'po'], ['City', 'city'], ['Province', 'prov'], ['Status', 'status'], ['Ink', 'ink'], ['Run Dates', 'run'], ['Design', 'design'], ['Tags', 'tags'], ['Latitude', 'lat'], ['Longitude', 'lng'], ['Address', 'addr']];
    var q = function (v) { v = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v); return '"' + v.replace(/"/g, '""').replace(/\n/g, ', ') + '"'; };
    var rows = [cols.map(function (c) { return q(c[0]); }).join(',')].concat(filtered.map(function (r) { return cols.map(function (c) { return q(c[1] === 'status' ? (retired(r) ? 'Retired' : 'Active') : r[c[1]]); }).join(','); }));
    var a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv' })), download: 'pictorial-cancels.csv' });
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- update cycle ---------- */
  function update(fit) {
    filtered = sortList(D.filter(function (c) { return match(c); }));
    el.count.innerHTML = '';
    el.count.appendChild(h('b', { text: filtered.length + (filtered.length === 1 ? ' cancel' : ' cancels') }));
    if (filtered.length !== D.length) el.count.appendChild(document.createTextNode(' of ' + D.length));
    el.yearOn.checked = !!S.year; el.yearR.disabled = !S.year; if (S.year) el.yearR.value = S.year; el.yearO.textContent = el.yearR.value;
    el.sort.value = S.sort;
    renderFilters();
    if (S.view === 'gallery') renderGallery(); else renderMap(fit);
    writeHash();
  }

  /* ---------- boot ---------- */
  readHash(); build();
  el.count.textContent = 'Loading cancels…';
  fetch(BASE + 'data.json').then(function (r) { return r.json(); }).then(function (j) {
    D = j.cancels; updated = j.updated;
    D.forEach(function (c, i) { c._o = i; byId[c.id] = c;
      c._s = [c.po, c.city, c.prov, c.pc, c.design, c.nick, (c.tags || []).join(' '), c.designer, c.ink].join(' ').toLowerCase(); });
    if (S.sort === 'near') S.sort = 'place';
    setView(S.view); update(true);
    if (S.id && byId[S.id]) select(S.id); else S.id = '';
  }).catch(function () { el.count.textContent = 'The cancel list could not be loaded. Please try again later.'; });
  window.addEventListener('hashchange', function () { var id = S.id; readHash(); el.search.value = S.q; setView(S.view); update(true); if (S.id !== id) select(S.id); });
})();
