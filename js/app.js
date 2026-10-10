/* Passenger Rake Links dashboard — UI */
(function () {
  const M = window.RakeModel;
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    kids.flat().forEach((c) => c != null && n.append(c.nodeType ? c : document.createTextNode(c)));
    return n;
  };
  const rakeColor = (i) => getComputedStyle(document.documentElement).getPropertyValue(`--rake-${i % 6}`).trim();
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;

  const state = {
    data: null, stations: null, paths: null,
    link: null, services: [], cycles: [],
    t: 480, playing: false, speed: 30,
    sel: null,            // {type:'stn', code} | {type:'svc', train}
    hiddenRakes: new Set(),
    sort: { k: 'sr', dir: 1 }, q: '',
  };

  /* ---------- load ---------- */
  Promise.all([
    fetch('data/links.json').then((r) => r.json()),
    fetch('data/stations.json').then((r) => r.json()),
  ]).then(([links, stns]) => {
    state.data = links;
    state.stations = stns.stations;
    state.paths = stns.paths;
    $('#srcNote').textContent = `Source: ${links.source}`;
    const sel = $('#linkSelect');
    links.links.forEach((l) => sel.append(new Option(l.title, l.no)));
    sel.addEventListener('change', () => openLink(+sel.value));
    const fromHash = +(location.hash.match(/link-(\d+)/) || [])[1];
    openLink(links.links.some((l) => l.no === fromHash) ? fromHash : links.links[0].no);
  }).catch((e) => {
    $('#linkTitle').textContent = 'Could not load data';
    $('#linkNote').textContent = 'Open this page from a web server (GitHub Pages), not as a local file. ' + e.message;
  });

  function openLink(no) {
    const link = state.data.links.find((l) => l.no === no);
    state.link = link;
    state.services = M.prepare(link.services);
    state.cycles = M.buildCycles(state.services);
    state.sel = null;
    state.hiddenRakes.clear();
    $('#linkSelect').value = no;
    history.replaceState(null, '', `#link-${no}`);
    renderHead();
    renderKpis();
    renderMap();
    renderTimeline();
    renderTable();
    renderSide();
    setTime(state.t);
  }

  /* ---------- heading & check ---------- */
  function renderHead() {
    const l = state.link;
    $('#linkChips').replaceChildren(
      el('span', { class: 'chip brand' }, `Link ${String(l.no).padStart(2, '0')}`),
      el('span', { class: 'chip' }, `${l.cars} car ${l.stock}`),
      el('span', { class: 'chip' }, `${l.rakes_as_per_sheet ?? '—'} rake${l.rakes_as_per_sheet > 1 ? 's' : ''} as per sheet`),
    );
    $('#linkTitle').textContent = l.title;
    $('#linkNote').textContent = l.remarks ? `Remarks: ${l.remarks}` : '';

    const needed = state.cycles.reduce((t, c) => t + (c.days || 1), 0);
    const open = state.cycles.filter((c) => !c.closed);
    const ok = !open.length && needed === l.rakes_as_per_sheet;
    const box = $('#rakeCheck');
    box.className = 'check ' + (ok ? 'ok' : 'warn');
    box.replaceChildren(
      el('span', { class: 'dot' }),
      el('div', {},
        el('b', {}, ok ? 'Link closes' : 'Check link'),
        el('div', { class: 'muted small' },
          open.length
            ? `${open.length} chain(s) do not return to start station`
            : `${needed} rake${needed > 1 ? 's' : ''} needed by timings · ${l.rakes_as_per_sheet} in sheet`),
      ),
    );
  }

  /* ---------- KPIs ---------- */
  function renderKpis() {
    const svcs = state.services, cyc = state.cycles;
    const run = svcs.reduce((t, s) => t + s.run, 0);
    const util = cyc.map((c) => c.runMins / ((c.days || 1) * M.DAY));
    const avgUtil = util.reduce((a, b) => a + b, 0) / util.length;
    const stns = new Set(svcs.flatMap((s) => [s.from, s.to]));
    const longest = cyc.map((c) => c.longestHalt).filter(Boolean).sort((a, b) => b.mins - a.mins)[0];
    const k = (lbl, val, hint) => el('div', { class: 'kpi' },
      el('div', { class: 'lbl' }, lbl), el('div', { class: 'val' }, ...[].concat(val)), el('div', { class: 'hint' }, hint));
    $('#kpis').replaceChildren(
      k('Services', String(svcs.length), `${new Set(svcs.map((s) => s.train_no)).size} train numbers`),
      k('Rakes', String(cyc.length), cyc.map((c) => `${c.name}: ${c.services.length} svc`).join(' · ')),
      k('Running time', [String(Math.floor(run / 60)), el('small', {}, `h ${run % 60}m`)], 'all services, per day'),
      k('Rake running', [String(Math.round(avgUtil * 100)), el('small', {}, '%')], 'of 24h, average per rake'),
      k('Terminals', String(stns.size), [...stns].join(' · ')),
      k('Longest halt', longest ? [M.dur(longest.mins)] : ['—'], longest ? `at ${longest.at}, ${M.fmt(longest.from)}–${M.fmt(longest.to)}` : ''),
    );
  }

  /* ---------- map ---------- */
  let map, stnLayer, lineLayer, pinLayer, lines = [], pins = [];
  const coord = (c) => [state.stations[c].lat, state.stations[c].lon];
  const pathOf = (s) => (state.paths[s.route] || [s.from, s.to]).filter((c) => state.stations[c]).map(coord);

  function renderMap() {
    if (!map) {
      map = L.map('map', { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
      L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, {
        maxZoom: 18, subdomains: 'abcd',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      }).addTo(map);
      lineLayer = L.layerGroup().addTo(map);
      stnLayer = L.layerGroup().addTo(map);
      pinLayer = L.layerGroup().addTo(map);
      map.on('click', () => select(null));
    }
    lineLayer.clearLayers(); stnLayer.clearLayers(); pinLayer.clearLayers();
    lines = []; pins = [];

    // route lines, one per service
    state.services.forEach((s) => {
      const color = rakeColor(s.rake);
      const casing = L.polyline(pathOf(s), { color: dark ? '#0f141b' : '#fff', weight: 9, opacity: .9 }).addTo(lineLayer);
      const pl = L.polyline(pathOf(s), { color, weight: 5, opacity: .85, lineCap: 'round' }).addTo(lineLayer);
      pl.bindTooltip(`<b>${s.train_no}</b> ${s.route}<br>${s.dep} → ${s.arr}`, { sticky: true });
      pl.on('click', (e) => { L.DomEvent.stop(e); select({ type: 'svc', train: s.train_no }); });
      lines.push({ s, pl, casing });
    });

    // stations: terminals of this link big, drawing points small
    const used = new Set(state.services.flatMap((s) => [s.from, s.to]));
    const drawn = new Set(state.services.flatMap((s) => state.paths[s.route] || [s.from, s.to]));
    drawn.forEach((code) => {
      const st = state.stations[code];
      if (!st) return;
      const term = used.has(code);
      const n = state.services.filter((s) => s.from === code || s.to === code).length;
      const m = L.circleMarker(coord(code), {
        radius: term ? 7 + Math.min(n, 6) : 3.5,
        color: dark ? '#e6ebf1' : '#1d3557', weight: 2,
        fillColor: term ? (dark ? '#171e27' : '#fff') : (dark ? '#97a3b2' : '#9aa5b1'), fillOpacity: 1,
      }).addTo(stnLayer);
      m.bindTooltip(term ? `${code}` : `${code}`, {
        permanent: true, direction: 'right', offset: [term ? 10 : 6, 0],
        className: 'stn-label' + (term ? '' : ' via'),
      });
      if (term) {
        m.on('click', (e) => { L.DomEvent.stop(e); select({ type: 'stn', code }); });
        m.bindPopup(() => `<b>${st.name}</b> (${code})<br>${n} service${n > 1 ? 's' : ''} start/end here`, { autoPan: false });
        m.on('mouseover', () => m.openPopup());
        m.on('mouseout', () => m.closePopup());
      }
    });

    // rake pins
    state.cycles.forEach((c) => {
      const icon = L.divIcon({
        className: '', iconSize: [30, 30], iconAnchor: [15, 15],
        html: `<div class="rake-pin" style="background:${rakeColor(c.id)}">${String.fromCharCode(65 + c.id)}</div>`,
      });
      const mk = L.marker(coord(c.services[0].from), { icon, zIndexOffset: 1000 }).addTo(pinLayer);
      mk.on('click', (e) => {
        L.DomEvent.stop(e);
        const p = M.rakeAt(c, state.t);
        select(p.state === 'run' ? { type: 'svc', train: p.svc.train_no } : { type: 'stn', code: p.at });
      });
      pins.push({ c, mk });
    });

    const all = [...drawn].filter((c) => state.stations[c]).map(coord);
    map.fitBounds(all, { padding: [40, 40] });

    // legend
    $('#rakeLegend').replaceChildren(...state.cycles.map((c) => {
      const sp = el('span', { title: 'Show / hide' }, el('i', { style: `background:${rakeColor(c.id)}` }),
        `${c.name} · ${c.services[0].from}${c.closed ? ' ⟲' : ''}`);
      sp.addEventListener('click', () => {
        state.hiddenRakes.has(c.id) ? state.hiddenRakes.delete(c.id) : state.hiddenRakes.add(c.id);
        sp.classList.toggle('off');
        paintSelection();
      });
      return sp;
    }));
  }

  function pointAlong(latlngs, frac) {
    const pts = latlngs.map((p) => L.latLng(p));
    const seg = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const d = pts[i - 1].distanceTo(pts[i]); seg.push(d); total += d; }
    let goal = total * Math.min(Math.max(frac, 0), 1);
    for (let i = 0; i < seg.length; i++) {
      if (goal <= seg[i]) {
        const f = seg[i] ? goal / seg[i] : 0;
        return [pts[i].lat + (pts[i + 1].lat - pts[i].lat) * f, pts[i].lng + (pts[i + 1].lng - pts[i].lng) * f];
      }
      goal -= seg[i];
    }
    return [pts[pts.length - 1].lat, pts[pts.length - 1].lng];
  }

  /* ---------- clock ---------- */
  function setTime(t) {
    state.t = ((t % M.DAY) + M.DAY) % M.DAY;
    $('#timeSlider').value = Math.floor(state.t);
    $('#timeOut').textContent = M.fmt(state.t);
    const rows = [];
    pins.forEach(({ c, mk }) => {
      const p = M.rakeAt(c, state.t);
      const hidden = state.hiddenRakes.has(c.id);
      mk.setOpacity(hidden ? 0 : 1);
      const node = mk.getElement() && mk.getElement().firstChild;
      if (p.state === 'run') {
        mk.setLatLng(pointAlong(pathOf(p.svc), p.frac));
        node && node.classList.add('running');
        rows.push(el('div', { class: 'r' }, el('i', { style: `background:${rakeColor(c.id)}` }),
          el('div', {}, el('b', {}, `${c.name} running ${p.svc.train_no}`),
            el('div', { class: 'muted' }, `${p.svc.from} → ${p.svc.to} · arr ${p.svc.arr}`))));
      } else {
        mk.setLatLng(coord(p.at));
        node && node.classList.remove('running');
        const nxt = p.halt ? c.services.find((s) => s.depMin === p.halt.to && s.from === p.at) : null;
        rows.push(el('div', { class: 'r' }, el('i', { style: `background:${rakeColor(c.id)}` }),
          el('div', {}, el('b', {}, `${c.name} at ${p.at}`),
            el('div', { class: 'muted' }, nxt ? `next ${nxt.train_no} at ${nxt.dep}` : 'no further working'))));
      }
    });
    $('#nowBoard').replaceChildren(...rows);
    const nl = $('#timeline .nowline');
    if (nl) { const x = tlX(state.t); nl.setAttribute('x1', x); nl.setAttribute('x2', x); }
  }

  let last = 0;
  function tick(ts) {
    if (!state.playing) return;
    if (last) setTime(state.t + ((ts - last) / 1000) * state.speed);
    last = ts;
    requestAnimationFrame(tick);
  }
  $('#playBtn').addEventListener('click', () => {
    state.playing = !state.playing;
    $('#playBtn').textContent = state.playing ? '❚❚' : '▶';
    $('#playBtn').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    last = 0;
    if (state.playing) requestAnimationFrame(tick);
  });
  $('#timeSlider').addEventListener('input', (e) => setTime(+e.target.value));
  document.querySelectorAll('.speed .chip-btn').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.speed .chip-btn').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    state.speed = +b.dataset.speed;
  }));

  /* ---------- timeline ---------- */
  let tlX = () => 0;
  function renderTimeline() {
    const box = $('#timeline');
    const W = Math.max(box.clientWidth, 720), left = 86, right = 16, rowH = 46, top = 26;
    const H = top + state.cycles.length * rowH + 8;
    tlX = (m) => left + (m / M.DAY) * (W - left - right);
    const NS = 'http://www.w3.org/2000/svg';
    const s = (tag, a = {}, txt) => { const n = document.createElementNS(NS, tag); for (const k in a) n.setAttribute(k, a[k]); if (txt != null) n.textContent = txt; return n; };
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
    const grid = s('g', { class: 'grid' }), ax = s('g', { class: 'ax' });
    for (let h = 0; h <= 24; h += 2) {
      const x = tlX(h * 60);
      grid.append(s('line', { x1: x, x2: x, y1: top - 4, y2: H - 4 }));
      ax.append(s('text', { x, y: 14, 'text-anchor': 'middle' }, String(h).padStart(2, '0')));
    }
    svg.append(grid, ax);

    // pieces that may cross midnight
    const pieces = (from, mins) => {
      const end = from + mins;
      return end <= M.DAY ? [[from, end]] : [[from, M.DAY], [0, end - M.DAY]];
    };

    state.cycles.forEach((c, i) => {
      const y = top + i * rowH, bh = 26, by = y + 8;
      const color = rakeColor(c.id);
      svg.append(s('text', { x: 8, y: by + 17, 'font-weight': 600 }, c.name));
      c.halts.forEach((h) => {
        if (!h) return;
        pieces(h.from, h.mins).forEach(([a, b]) => {
          const g = s('g', { class: 'halt' });
          g.append(s('rect', { x: tlX(a), y: by + 8, width: Math.max(0, tlX(b) - tlX(a)), height: 10, rx: 3 }));
          if (tlX(b) - tlX(a) > 40) g.append(s('text', { x: (tlX(a) + tlX(b)) / 2, y: by + 32, 'text-anchor': 'middle' }, h.at));
          g.addEventListener('mousemove', (e) => tip(e, `<b>${h.at}</b> halt<br>${M.fmt(h.from)} – ${M.fmt(h.to)} · ${M.dur(h.mins)}`));
          g.addEventListener('mouseleave', hideTip);
          g.addEventListener('click', () => select({ type: 'stn', code: h.at }));
          svg.append(g);
        });
      });
      c.services.forEach((sv) => {
        pieces(sv.depMin, sv.run).forEach(([a, b]) => {
          const g = s('g', { class: 'run', 'data-train': sv.train_no });
          const w = Math.max(2, tlX(b) - tlX(a));
          g.append(s('rect', { x: tlX(a), y: by, width: w, height: bh, rx: 5, fill: color }));
          if (w > 44) g.append(s('text', { x: tlX(a) + w / 2, y: by + 17, 'text-anchor': 'middle', fill: '#fff', 'font-weight': 600, style: 'fill:#fff' }, sv.train_no));
          g.addEventListener('mousemove', (e) => tip(e, `<b>${sv.train_no}</b> ${sv.route}<br>${sv.from} ${sv.dep} → ${sv.to} ${sv.arr}<br>Run ${M.dur(sv.run)}`));
          g.addEventListener('mouseleave', hideTip);
          g.addEventListener('click', () => select({ type: 'svc', train: sv.train_no }));
          svg.append(g);
        });
      });
    });
    svg.append(s('line', { class: 'nowline', x1: tlX(state.t), x2: tlX(state.t), y1: top - 6, y2: H - 2 }));
    svg.addEventListener('click', (e) => {
      if (e.target === svg) {
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        if (p.x >= left) setTime(((p.x - left) / (W - left - right)) * M.DAY);
      }
    });
    box.replaceChildren(svg);
  }
  let rT;
  addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (state.link) { renderTimeline(); paintSelection(); } }, 150); });

  /* ---------- table ---------- */
  function renderTable() {
    const tb = $('#svcTable tbody');
    const q = state.q.trim().toLowerCase();
    const { k, dir } = state.sort;
    const val = (s) => ({ sr: s.sr, train_no: s.train_no, route: s.route, dep: s.depMin, arr: s.arrMin, run: s.run, rake: s.rake, next: s.next || '' }[k]);
    const rows = state.services
      .filter((s) => !q || [s.train_no, s.route, s.from, s.to].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
    tb.replaceChildren(...rows.map((s) => {
      const c = state.cycles[s.rake];
      const tr = el('tr', { 'data-train': s.train_no },
        el('td', {}, String(s.sr)),
        el('td', { class: 'mono' }, el('b', {}, s.train_no)),
        el('td', {}, s.route),
        el('td', { class: 'mono' }, `${s.from} ${s.dep}`),
        el('td', { class: 'mono' }, `${s.to} ${s.arr}`, s.overnight ? el('span', { class: 'ovn' }, '+1') : null),
        el('td', { class: 'mono' }, M.dur(s.run)),
        el('td', {}, el('span', { class: 'tag', style: `background:${rakeColor(s.rake)}` }, c.name)),
        el('td', { class: 'mono' }, s.next ? `${s.next} · ${M.dur(s.haltAfter.mins)} at ${s.to}` : '—'),
      );
      tr.addEventListener('click', () => select({ type: 'svc', train: s.train_no }));
      return tr;
    }));
    document.querySelectorAll('#svcTable th').forEach((th) => {
      th.setAttribute('aria-sort', th.dataset.k === k ? (dir > 0 ? 'ascending' : 'descending') : 'none');
    });
    paintSelection();
  }
  document.querySelectorAll('#svcTable th').forEach((th) => th.addEventListener('click', () => {
    state.sort = { k: th.dataset.k, dir: state.sort.k === th.dataset.k ? -state.sort.dir : 1 };
    renderTable();
  }));
  $('#search').addEventListener('input', (e) => { state.q = e.target.value; renderTable(); });

  /* ---------- side panel ---------- */
  function renderSide() {
    const body = $('#sideBody');
    $('#clearSel').hidden = !state.sel;
    if (!state.sel) {
      $('#sideTitle').textContent = 'Rake cycles';
      body.replaceChildren(...state.cycles.map((c) => chainView(c, null)));
      return;
    }
    if (state.sel.type === 'stn') {
      const code = state.sel.code, st = state.stations[code];
      $('#sideTitle').textContent = `${st ? st.name : code} (${code})`;
      const arr = state.services.filter((s) => s.to === code).sort((a, b) => a.arrMin - b.arrMin);
      const dep = state.services.filter((s) => s.from === code).sort((a, b) => a.depMin - b.depMin);
      const row = (s, t, other) => {
        const r = el('div', { class: 'row' }, el('span', { class: 'mono t' }, t),
          el('span', {}, el('b', { class: 'mono' }, s.train_no), ' ', el('span', { class: 'muted' }, other)),
          el('span', { class: 'tag', style: `background:${rakeColor(s.rake)}` }, state.cycles[s.rake].name));
        r.addEventListener('click', () => select({ type: 'svc', train: s.train_no }));
        return r;
      };
      body.replaceChildren(el('div', { class: 'board' },
        el('h4', {}, `Arrivals (${arr.length})`), ...(arr.length ? arr.map((s) => row(s, s.arr, `from ${s.from}`)) : [el('p', { class: 'muted small' }, 'None')]),
        el('h4', {}, `Departures (${dep.length})`), ...(dep.length ? dep.map((s) => row(s, s.dep, `to ${s.to}`)) : [el('p', { class: 'muted small' }, 'None')]),
      ));
      return;
    }
    const s = state.services.find((x) => x.train_no === state.sel.train);
    const c = state.cycles[s.rake];
    $('#sideTitle').textContent = `Train ${s.train_no}`;
    body.replaceChildren(el('div', { class: 'svc-detail' },
      el('div', { class: 'big' }, s.route),
      el('dl', {},
        el('dt', {}, 'Departs'), el('dd', { class: 'mono' }, `${s.from} ${s.dep}`),
        el('dt', {}, 'Arrives'), el('dd', { class: 'mono' }, `${s.to} ${s.arr}${s.overnight ? ' (+1)' : ''}`),
        el('dt', {}, 'Run time'), el('dd', {}, M.dur(s.run)),
        el('dt', {}, 'Rake'), el('dd', {}, c.name),
        el('dt', {}, 'In sheet'), el('dd', { class: 'mono' }, `${s.dep_raw} → ${s.arr_raw}`),
      ),
    ), chainView(c, s.train_no));
  }

  function chainView(c, cur) {
    const color = rakeColor(c.id);
    const wrap = el('div', { class: 'chain', style: `color:${color}` });
    wrap.append(el('div', { style: 'color:var(--ink);font-weight:600;margin-bottom:6px' },
      `${c.name} · ${c.services.length} services · running ${M.dur(c.runMins)}`));
    c.services.forEach((s, i) => {
      const h = c.halts[i];
      const step = el('div', { class: 'step' + (s.train_no === cur ? ' cur' : '') },
        el('div', { class: 'rail' }, el('b'), el('s')),
        el('div', { class: 'txt', style: 'color:var(--ink);cursor:pointer' },
          el('b', { class: 'mono' }, s.train_no), ` ${s.from} ${s.dep} → ${s.to} ${s.arr}`,
          h ? el('div', { class: 'muted small' }, `halt ${M.dur(h.mins)} at ${h.at}`) : null));
      step.querySelector('.txt').addEventListener('click', () => select({ type: 'svc', train: s.train_no }));
      wrap.append(step);
    });
    if (c.closed) wrap.append(el('div', { class: 'muted small', style: 'color:var(--muted)' }, `⟲ back to ${c.services[0].from}, cycle repeats`));
    return wrap;
  }

  /* ---------- selection ---------- */
  function select(sel) {
    state.sel = sel;
    renderSide();
    paintSelection();
    if (sel && sel.type === 'svc') {
      const ln = lines.find((l) => l.s.train_no === sel.train);
      ln && map.fitBounds(ln.pl.getBounds(), { padding: [60, 60], maxZoom: 10 });
    }
  }
  $('#clearSel').addEventListener('click', () => select(null));

  function paintSelection() {
    const sel = state.sel;
    const hit = (s) => !sel || (sel.type === 'svc' ? s.train_no === sel.train : s.from === sel.code || s.to === sel.code);
    lines.forEach(({ s, pl, casing }) => {
      const hidden = state.hiddenRakes.has(s.rake);
      const on = hit(s);
      pl.setStyle({ opacity: hidden ? 0 : on ? .95 : .15, weight: sel && on ? 7 : 5 });
      casing.setStyle({ opacity: hidden ? 0 : on ? .9 : .2 });
      if (on && sel) pl.bringToFront();
    });
    document.querySelectorAll('#svcTable tbody tr').forEach((tr) => {
      const s = state.services.find((x) => x.train_no === tr.dataset.train);
      tr.classList.toggle('sel', !!sel && hit(s));
    });
    document.querySelectorAll('#timeline .run').forEach((g) => {
      const s = state.services.find((x) => x.train_no === g.dataset.train);
      g.classList.toggle('sel', !!sel && sel.type === 'svc' && hit(s));
      g.style.opacity = state.hiddenRakes.has(s.rake) ? .15 : !sel || hit(s) ? 1 : .35;
    });
    pins.forEach(({ c, mk }) => mk.setOpacity(state.hiddenRakes.has(c.id) ? 0 : 1));
  }

  /* ---------- tooltip ---------- */
  const tipEl = $('#tip');
  function tip(e, html) {
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  function hideTip() { tipEl.hidden = true; }
})();
