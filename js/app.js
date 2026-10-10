/* Passenger Rake Links dashboard — UI */
(function () {
  const M = window.RakeModel;
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    kids.flat().forEach((c) => c != null && c !== false && n.append(c.nodeType ? c : document.createTextNode(c)));
    return n;
  };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const tag = (t) => (t ? el('span', { class: `tag ${t}` }, t) : null);

  const state = {
    data: null, stations: null, paths: null,
    link: null, model: null,
    t: 0, playing: false, speed: 60,
    sel: null, // {type:'stn', code} | {type:'svc', train}
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
    links.links.forEach((l) => sel.append(new Option(`${String(l.no).padStart(2, '0')} · ${l.name}`, l.no)));
    sel.addEventListener('change', () => openLink(+sel.value));
    setupSearch();
    const fromHash = +(location.hash.match(/link-(\d+)/) || [])[1];
    openLink(links.links.some((l) => l.no === fromHash) ? fromHash : links.links[0].no);
  }).catch((e) => {
    $('#linkTitle').textContent = 'Could not load data';
    $('#linkNote').textContent = 'Open this page from a web server (GitHub Pages), not as a local file. ' + e.message;
  });

  /* ---------- train search ---------- */
  function setupSearch() {
    const input = $('#trainSearch'), list = $('#trainList'), msg = $('#searchMsg');
    const index = [];
    state.data.links.forEach((l) => {
      l.services.forEach((s) => index.push({ train: s.train_no, link: l, s }));
      (l.sheet_only || []).forEach((s) => index.push({ train: s.train_no, link: l, s, sheetOnly: true }));
    });
    list.replaceChildren(...index.map((r) => el('option', { value: r.train }, `${r.s.from}-${r.s.to} · Link ${String(r.link.no).padStart(2, '0')} ${r.link.name}`)));
    const go = () => {
      const q = input.value.replace(/\D/g, '');
      if (!q) { msg.hidden = true; return; }
      const exact = index.find((r) => r.train === q);
      const hits = exact ? [exact] : index.filter((r) => r.train.startsWith(q));
      const links = [...new Set(hits.map((r) => r.link.no))];
      if (hits.length && links.length === 1 && (exact || hits.length === 1)) {
        openLink(hits[0].link.no, hits[0].sheetOnly ? null : hits[0].train);
        msg.hidden = !hits[0].sheetOnly;
        if (hits[0].sheetOnly) {
          msg.textContent = `${hits[0].train} is listed under this link in the sheet but is not in the ICMS link`;
          document.getElementById('diffCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        input.blur();
      } else if (hits.length) {
        msg.hidden = false;
        msg.textContent = `${hits.length} trains match — keep typing`;
      } else {
        msg.hidden = false;
        msg.textContent = `Train ${q} not found in any link`;
      }
    };
    input.addEventListener('change', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    input.addEventListener('input', () => { if (/^\d{5}$/.test(input.value.trim())) go(); else msg.hidden = true; });
  }

  function openLink(no, train) {
    state.link = state.data.links.find((l) => l.no === no);
    state.model = M.build(state.link);
    state.sel = null;
    $('#linkSelect').value = no;
    history.replaceState(null, '', `#link-${no}`);
    $('#timeSlider').max = state.model.cycle - 1;
    renderHead();
    renderTiles();
    renderJourney();
    renderMap();
    renderTimeline();
    renderDiffs();
    renderSide();
    setTime(state.model.start);
    if (train) {
      select({ type: 'svc', train });
      const seg = document.querySelector(`.seg[data-train="${train}"]`);
      seg && seg.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  }

  const stnName = (c) => (state.stations[c] ? state.stations[c].name : c);
  const svcAt = (code) => state.model.services.filter((s) => s.from === code || s.to === code);
  const stnInDiv = (code) => svcAt(code).some((s) => s.in_division);

  /* ---------- heading ---------- */
  function renderHead() {
    const l = state.link;
    $('#linkChips').replaceChildren(
      el('span', { class: 'chip brand' }, `Link ${String(l.no).padStart(2, '0')}`),
      el('span', { class: 'chip' }, `${l.cars} car ${l.stock}`),
      el('span', { class: 'chip' }, `PM depot: ${l.pm_depot}`),
      el('span', { class: 'chip' }, `Timings: ${l.timing_source}`),
    );
    $('#linkTitle').textContent = l.name;
    $('#linkNote').textContent = l.notes || '';
  }

  /* ---------- tiles ---------- */
  function renderTiles() {
    const m = state.model, l = state.link;
    // route
    const line = $('#routeLine');
    line.replaceChildren();
    m.route.forEach(({ code, svc, ecr }, i) => {
      if (i) {
        if (ecr) line.append(el('span', { class: 'ar ecr', title: 'Empty rake' }, '⇢'));
        else line.append(el('span', { class: 'ar' + (svc.in_division ? '' : ' oth'), title: `${svc.train_no}` }, '→'));
      }
      const isPM = (i === 0 || i === m.route.length - 1) && code === l.pm_station;
      line.append(el('span', {
        class: 'st' + (isPM ? ' pm' : stnInDiv(code) ? '' : ' oth'),
        title: stnName(code) + (isPM ? ' · PM' : ''),
        onclick: () => select({ type: 'stn', code }),
      }, code));
    });
    $('#routeHint').textContent = `${m.services.length} services over ${m.days} day${m.days > 1 ? 's' : ''} · starts and ends at ${l.pm_station} (PM)`;

    // rakes
    $('#rakesVal').textContent = String(l.rakes);
    const rh = $('#rakesHint');
    if (m.days !== l.rakes) {
      rh.className = 'hint warn';
      rh.textContent = `Timings below return to ${l.pm_station} after ${m.days} days; sheet shows ${l.rakes_in_sheet}. Check the full ICMS link.`;
    } else {
      rh.className = 'hint';
      rh.textContent = `${m.days}-day cycle · sheet shows ${l.rakes_in_sheet}`;
    }

    // longest halt
    const hs = m.halts.filter((h) => !h.ecr).sort((a, b) => b.mins - a.mins);
    const top = hs[0], next = hs.find((h) => h.at !== top.at);
    $('#haltVal').replaceChildren(M.dur(top.mins), el('small', {}, `at ${top.at}`));
    $('#haltHint').textContent = `${M.stamp(top.fromAbs)} → ${top.wraps ? 'next cycle ' : ''}${M.hhmm(top.toAbs)}${top.at === l.pm_station ? ' (PM)' : ''}`
      + (next ? ` · next: ${next.at} ${M.dur(next.mins)}` : '');
  }

  /* ---------- journey (day rows) ---------- */
  function renderJourney() {
    const m = state.model, box = $('#journey');
    box.replaceChildren();
    const longCut = 6 * 60;
    const lastDay = Math.max(...m.services.map((x) => x.dep_day));
    for (let d = 1; d <= lastDay; d++) {
      const svcs = m.services.filter((s) => s.dep_day === d);
      if (!svcs.length) continue;
      const flow = el('div', { class: 'flow' });
      svcs.forEach((s, i) => {
        const idx = m.services.indexOf(s);
        const prev = m.services[idx - 1];
        if (i === 0 && prev && prev.haltAfter.ecr) {
          flow.append(el('div', { class: 'seg ecr', title: prev.haltAfter.ecr.note || 'Empty rake' },
            el('div', { class: 'no' }, 'Empty'), el('div', { class: 'bar' }), el('div', { class: 'rt' }, `${prev.to} → ${s.from}`)));
        }
        if (i === 0) {
          // opening node of the day
          const lines = [];
          if (prev && prev.haltAfter.ecr) lines.push(el('div', { class: 't ecr-t' }, `empty rake ex ${prev.to}`));
          else if (prev) lines.push(el('div', { class: 't' }, `arr D${prev.arr_day} ${prev.arr}`));
          lines.push(el('div', { class: 't' }, 'dep ', el('b', {}, s.dep), tag(s.dep_tag)));
          flow.append(node(s.from, lines, null, !stnInDiv(s.from)));
        }
        flow.append(segment(s));
        const nx = m.services[idx + 1];
        const h = s.haltAfter;
        const lines = [el('div', { class: 't' }, 'arr ', el('b', {}, s.arr), tag(s.arr_tag))];
        if (h.ecr) {
          lines.push(el('div', { class: 't ecr-t' }, `empty rake to ${h.ecr.to}`));
        } else if (nx && nx.dep_day === d) {
          lines.push(el('div', { class: 't' }, 'dep ', el('b', {}, nx.dep), tag(nx.dep_tag)));
        } else if (nx) {
          lines.push(el('div', { class: 't' }, `dep D${nx.dep_day} ${nx.dep}`, tag(nx.dep_tag)));
        } else {
          lines.push(el('div', { class: 't' }, `next cycle ${m.services[0].dep}`, tag(m.services[0].dep_tag)));
        }
        const haltTxt = h.ecr
          ? el('div', { class: 'halt' }, `${M.dur(h.mins)} till dep ex ${h.ecr.to}${nx && nx.dep_day !== d ? ` · ↓ Day ${nx.dep_day}` : ''}`)
          : el('div', { class: 'halt' + (h.mins >= longCut ? ' long' : '') },
            `halt ${M.dur(h.mins)}${!nx ? ' · ↺ Day 1' : nx.dep_day !== d ? ` · ↓ Day ${nx.dep_day}` : ''}`);
        flow.append(node(s.to, lines, haltTxt, !stnInDiv(s.to)));
        if (h.ecr && nx && nx.dep_day === d) {
          flow.append(el('div', { class: 'seg ecr', title: h.ecr.note || 'Empty rake' },
            el('div', { class: 'no' }, 'Empty'), el('div', { class: 'bar' }), el('div', { class: 'rt' }, `${h.ecr.from} → ${h.ecr.to}`)));
          flow.append(node(h.ecr.to, [el('div', { class: 't' }, 'dep ', el('b', {}, nx.dep), tag(nx.dep_tag))], null, false));
        }
      });
      box.append(el('div', { class: 'day' }, el('div', { class: 'day-lbl' }, 'Day', el('b', {}, String(d))), flow));
    }
  }
  function node(code, lines, halt, oth) {
    return el('div', { class: 'node' + (oth ? ' oth' : ''), 'data-stn': code, title: stnName(code), onclick: () => select({ type: 'stn', code }) },
      el('div', { class: 'code' }, code), ...lines, halt);
  }
  function segment(s) {
    return el('div', {
      class: 'seg' + (s.in_division ? '' : ' oth'), 'data-train': s.train_no,
      onclick: () => select({ type: 'svc', train: s.train_no }),
      onmousemove: (e) => tip(e, `<b>${s.train_no}</b> ${s.from} → ${s.to}<br>${s.dep} → ${s.arr} · ${M.dur(s.run)}<br>${s.in_division ? 'Delhi Division' : 'Other division · not in sheet'}`),
      onmouseleave: hideTip,
    }, el('div', { class: 'no' }, s.train_no), el('div', { class: 'bar' }), el('div', { class: 'rt' }, M.dur(s.run)));
  }

  /* ---------- map ---------- */
  let map, lineLayer, stnLayer, pin, lines = [];
  const coord = (c) => [state.stations[c].lat, state.stations[c].lon];
  const pathOf = (s) => (state.paths[`${s.from}-${s.to}`] || [s.from, s.to]).filter((c) => state.stations[c]).map(coord);

  function renderMap() {
    if (!map) {
      map = L.map('map', { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      lineLayer = L.layerGroup().addTo(map);
      stnLayer = L.layerGroup().addTo(map);
      map.on('click', () => select(null));
    }
    lineLayer.clearLayers(); stnLayer.clearLayers(); lines = [];
    if (pin) { pin.remove(); pin = null; }

    const divC = css('--div'), othC = css('--oth');
    state.model.services.forEach((s) => {
      const casing = L.polyline(pathOf(s), { color: dark ? '#0f141b' : '#fff', weight: 9, opacity: .9 }).addTo(lineLayer);
      const pl = L.polyline(pathOf(s), {
        color: s.in_division ? divC : othC, weight: 5, opacity: .9, lineCap: 'round',
        dashArray: s.in_division ? null : '8 8',
      }).addTo(lineLayer);
      pl.bindTooltip(`<b>${s.train_no}</b> ${s.from} → ${s.to}<br>D${s.dep_day} ${s.dep} → ${s.arr}${s.in_division ? '' : '<br><i>Other division</i>'}`, { sticky: true });
      pl.on('click', (e) => { L.DomEvent.stop(e); select({ type: 'svc', train: s.train_no }); });
      lines.push({ s, pl, casing });
    });

    state.model.halts.filter((h) => h.ecr).forEach((h) => {
      const pts = (state.paths[`${h.ecr.from}-${h.ecr.to}`] || [h.ecr.from, h.ecr.to]).filter((c) => state.stations[c]).map(coord);
      L.polyline(pts, { color: css('--ecr'), weight: 4, opacity: .95, dashArray: '2 8', lineCap: 'round' })
        .bindTooltip(`<b>Empty rake</b> ${h.ecr.from} → ${h.ecr.to}${h.ecr.note ? '<br>' + h.ecr.note : ''}`, { sticky: true })
        .addTo(lineLayer);
    });
    const used = new Set(state.model.route.map((r) => r.code));
    const drawn = new Set(state.model.services.flatMap((s) => state.paths[`${s.from}-${s.to}`] || [s.from, s.to]));
    drawn.forEach((code) => {
      if (!state.stations[code]) return;
      const term = used.has(code);
      const isPM = code === state.link.pm_station;
      const mk = L.circleMarker(coord(code), {
        radius: term ? (isPM ? 10 : 8) : 3.5,
        color: isPM ? css('--pm') : dark ? '#e6ebf1' : '#1d3557', weight: term ? 3 : 1.5,
        fillColor: term ? (dark ? '#171e27' : '#fff') : (dark ? '#97a3b2' : '#9aa5b1'), fillOpacity: 1,
      }).addTo(stnLayer);
      mk.bindTooltip(code + (isPM ? ' · PM' : ''), { permanent: true, direction: 'right', offset: [term ? 11 : 6, 0], className: 'stn-label' + (term ? '' : ' via') });
      if (term) mk.on('click', (e) => { L.DomEvent.stop(e); select({ type: 'stn', code }); });
    });

    pin = L.marker(coord(state.model.services[0].from), {
      icon: L.divIcon({ className: '', iconSize: null, html: '<div class="rake-pin">●</div>' }),
      zIndexOffset: 1000,
    }).addTo(map);
    pin.on('click', (e) => {
      L.DomEvent.stop(e);
      const p = M.positionAt(state.model, state.t);
      select(p.state === 'run' ? { type: 'svc', train: p.svc.train_no } : { type: 'stn', code: p.at });
    });

    map.fitBounds([...drawn].filter((c) => state.stations[c]).map(coord), { padding: [36, 36] });
  }

  function pointAlong(latlngs, frac) {
    const pts = latlngs.map((p) => L.latLng(p));
    const seg = []; let total = 0;
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
    const c = state.model.cycle;
    state.t = ((t % c) + c) % c;
    $('#timeSlider').value = Math.floor(state.t);
    $('#timeOut').textContent = M.stamp(state.t);
    const p = M.positionAt(state.model, state.t);
    const node = pin && pin.getElement() && pin.getElement().firstChild;
    let msg;
    if (p.state === 'run') {
      pin && pin.setLatLng(pointAlong(pathOf(p.svc), p.frac));
      if (node) { node.textContent = p.svc.train_no; node.classList.add('running'); }
      msg = [el('b', {}, `Running ${p.svc.train_no}`), ` ${p.svc.from} → ${p.svc.to}, arrives ${p.svc.arr}`,
        p.svc.in_division ? '' : el('span', { class: 'muted' }, ' · other division')];
    } else {
      pin && pin.setLatLng(coord(p.at));
      if (node) { node.textContent = p.at; node.classList.remove('running'); }
      const nx = p.halt.next;
      msg = p.halt.ecr
        ? [el('b', {}, `Empty rake ${p.halt.ecr.from} → ${p.halt.ecr.to}`), ` · arr ${p.halt.ecr.from} ${M.hhmm(p.halt.fromAbs)}, next ${nx.train_no} dep ${nx.from} D${nx.dep_day} ${nx.dep}`]
        : [el('b', {}, `At ${stnName(p.at)}`), ` · next ${nx.train_no} dep D${p.halt.wraps ? 1 : nx.dep_day} ${nx.dep}`];
    }
    $('#nowBoard').replaceChildren(el('i'), el('span', {}, ...msg));
    const nl = $('#timeline .nowline');
    if (nl) {
      const day = Math.floor(state.t / M.DAY), x = tlX(state.t % M.DAY), y0 = tlRowY(day);
      nl.setAttribute('x1', x); nl.setAttribute('x2', x);
      nl.setAttribute('y1', y0 - 4); nl.setAttribute('y2', y0 + 34);
    }
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

  /* ---------- timeline: one row per day ---------- */
  let tlX = () => 0, tlRowY = () => 0;
  function renderTimeline() {
    const m = state.model, box = $('#timeline');
    $('#tlTitle').textContent = `Link timeline · ${m.days} day${m.days > 1 ? 's' : ''}`;
    const W = Math.max(box.clientWidth, 760), left = 62, right = 16, top = 26, rowH = 58;
    const H = top + m.days * rowH;
    tlX = (min) => left + (min / M.DAY) * (W - left - right);
    tlRowY = (d) => top + d * rowH + 6;
    const NS = 'http://www.w3.org/2000/svg';
    const s = (t, a = {}, txt) => { const n = document.createElementNS(NS, t); for (const k in a) n.setAttribute(k, a[k]); if (txt != null) n.textContent = txt; return n; };
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
    const grid = s('g', { class: 'grid' }), ax = s('g', { class: 'ax' });
    for (let h = 0; h <= 24; h += 2) {
      grid.append(s('line', { x1: tlX(h * 60), x2: tlX(h * 60), y1: top - 4, y2: H - 6 }));
      ax.append(s('text', { x: tlX(h * 60), y: 14, 'text-anchor': 'middle' }, String(h).padStart(2, '0')));
    }
    for (let d = 0; d < m.days; d++) ax.append(s('text', { x: 8, y: tlRowY(d) + 18, class: 'dayt' }, `Day ${d + 1}`));
    svg.append(grid, ax);

    // split an absolute span into per-day pieces
    const pieces = (a, b) => {
      const out = [];
      let x = a;
      while (x < b) {
        const end = Math.min(b, (Math.floor(x / M.DAY) + 1) * M.DAY);
        out.push([Math.floor(x / M.DAY) % m.days, x % M.DAY, end - Math.floor(x / M.DAY) * M.DAY]);
        x = end;
      }
      return out;
    };

    m.halts.forEach((h) => pieces(h.fromAbs, h.toAbs).forEach(([d, a, b]) => {
      const g = s('g', { class: 'halt' });
      const y = tlRowY(d);
      g.append(s('rect', { x: tlX(a), y: y + 9, width: Math.max(0, tlX(b) - tlX(a)), height: 8, rx: 3 }));
      if (tlX(b) - tlX(a) > 34) g.append(s('text', { x: (tlX(a) + tlX(b)) / 2, y: y + 32, 'text-anchor': 'middle' }, h.ecr ? `ECR ${h.ecr.from}→${h.ecr.to}` : h.at));
      g.addEventListener('mousemove', (e) => tip(e, `<b>${h.at}</b> halt ${M.dur(h.mins)}<br>${M.stamp(h.fromAbs)} → ${h.wraps ? 'next cycle ' + M.hhmm(h.toAbs) : M.stamp(h.toAbs)}`));
      g.addEventListener('mouseleave', hideTip);
      g.addEventListener('click', (e) => { e.stopPropagation(); select({ type: 'stn', code: h.at }); });
      svg.append(g);
    }));
    m.services.forEach((sv) => pieces(sv.depAbs, sv.arrAbs).forEach(([d, a, b]) => {
      const g = s('g', { class: 'run', 'data-train': sv.train_no });
      const y = tlRowY(d), w = Math.max(2, tlX(b) - tlX(a));
      g.append(s('rect', { class: sv.in_division ? 'div' : 'oth', x: tlX(a), y, width: w, height: 26, rx: 5 }));
      if (w > 42) g.append(s('text', { x: tlX(a) + w / 2, y: y + 17, 'text-anchor': 'middle', style: 'fill:#fff;font-weight:600' }, sv.train_no));
      g.addEventListener('mousemove', (e) => tip(e, `<b>${sv.train_no}</b> ${sv.from} → ${sv.to}<br>${sv.dep} → ${sv.arr} · ${M.dur(sv.run)}`));
      g.addEventListener('mouseleave', hideTip);
      g.addEventListener('click', (e) => { e.stopPropagation(); select({ type: 'svc', train: sv.train_no }); });
      svg.append(g);
    }));
    svg.append(s('line', { class: 'nowline' }));
    svg.addEventListener('click', (e) => {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      if (p.x < left || p.y < top - 4) return;
      const d = Math.min(m.days - 1, Math.max(0, Math.floor((p.y - top) / rowH)));
      setTime(d * M.DAY + ((p.x - left) / (W - left - right)) * M.DAY);
    });
    box.replaceChildren(svg);
  }
  let rT;
  addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (state.model) { renderTimeline(); paint(); setTime(state.t); } }, 150); });

  /* ---------- sheet vs ICMS ---------- */
  function renderDiffs() {
    const rows = state.model.services.filter((s) => s.sheet && (s.sheet.dep !== s.dep || s.sheet.arr !== s.arr));
    const only = state.link.sheet_only || [];
    $('#diffCard').hidden = !rows.length && !only.length;
    const cell = (a, b) => el('td', { class: 'mono' + (a !== b ? ' diff' : '') }, a);
    $('#diffTable').replaceChildren(
      el('thead', {}, el('tr', {}, ...['Train', 'From → To', 'Dep (sheet)', 'Dep (ICMS)', 'Arr (sheet)', 'Arr (ICMS)'].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...rows.map((s) => el('tr', {},
        el('td', { class: 'mono' }, el('b', {}, s.train_no)),
        el('td', {}, `${s.from} → ${s.to}`),
        cell(s.sheet.dep, s.dep), el('td', { class: 'mono' }, s.dep),
        cell(s.sheet.arr, s.arr), el('td', { class: 'mono' }, s.arr))),
        ...only.map((s) => el('tr', {},
          el('td', { class: 'mono' }, el('b', {}, s.train_no)),
          el('td', {}, `${s.from} → ${s.to}`),
          el('td', { class: 'mono diff' }, s.dep), el('td', { class: 'muted' }, 'not in link'),
          el('td', { class: 'mono diff' }, s.arr), el('td', { class: 'muted' }, 'not in link')))),
    );
  }

  /* ---------- side panel ---------- */
  function renderSide() {
    const body = $('#sideBody'), m = state.model;
    $('#clearSel').hidden = !state.sel;
    if (!state.sel) {
      $('#sideTitle').textContent = 'Station board';
      const codes = [...new Set(m.route.map((r) => r.code))];
      body.replaceChildren(
        el('p', { class: 'muted small', style: 'margin:0' }, 'Pick a station to see its arrivals and departures in this link.'),
        el('div', { class: 'stn-pick' }, ...codes.map((c) => el('button', { class: 'chip-btn', onclick: () => select({ type: 'stn', code: c }) }, c))),
      );
      return;
    }
    if (state.sel.type === 'stn') {
      const code = state.sel.code;
      $('#sideTitle').textContent = `${stnName(code)} (${code})`;
      const arr = m.services.filter((s) => s.to === code).sort((a, b) => a.arrAbs - b.arrAbs);
      const dep = m.services.filter((s) => s.from === code).sort((a, b) => a.depAbs - b.depAbs);
      const row = (s, when, other, t) => el('div', { class: 'row' + (s.in_division ? '' : ' oth'), onclick: () => select({ type: 'svc', train: s.train_no }) },
        el('span', { class: 'mono' }, when),
        el('span', {}, el('b', { class: 'mono' }, s.train_no), ' ', el('span', { class: 'muted' }, other), tag(t)));
      const halts = m.halts.filter((h) => h.at === code);
      body.replaceChildren(el('div', { class: 'board' },
        el('h4', {}, `Arrivals (${arr.length})`), ...(arr.length ? arr.map((s) => row(s, `D${s.arr_day} ${s.arr}`, `from ${s.from}`)) : [el('p', { class: 'muted small' }, 'None')]),
        el('h4', {}, `Departures (${dep.length})`), ...(dep.length ? dep.map((s) => row(s, `D${s.dep_day} ${s.dep}`, `to ${s.to}`, s.dep_tag)) : [el('p', { class: 'muted small' }, 'None')]),
        halts.length ? el('h4', {}, 'Halts') : null,
        ...halts.map((h) => el('div', { class: 'small', style: 'padding:2px 8px' }, `${M.dur(h.mins)} · ${M.stamp(h.fromAbs)} → ${h.wraps ? 'next cycle ' + M.hhmm(h.toAbs) : M.stamp(h.toAbs)}`)),
      ));
      return;
    }
    const s = m.services.find((x) => x.train_no === state.sel.train);
    const idx = m.services.indexOf(s);
    const prev = m.services[idx - 1] || m.services[m.services.length - 1];
    $('#sideTitle').textContent = `Train ${s.train_no}`;
    const sheetCell = (a, b) => (a === b ? el('span', { class: 'mono' }, a) : el('span', { class: 'mono diff' }, `${a} (ICMS ${b})`));
    body.replaceChildren(el('div', { class: 'svc-detail' },
      el('div', { class: 'big' }, `${s.from} → ${s.to}`),
      el('div', { style: 'margin-top:4px' }, el('span', { class: 'pill ' + (s.in_division ? 'div' : 'oth') }, s.in_division ? 'Delhi Division' : 'Other division · not in sheet')),
      el('dl', {},
        el('dt', {}, 'Departs'), el('dd', { class: 'mono' }, `${s.from} D${s.dep_day} ${s.dep}`, tag(s.dep_tag)),
        el('dt', {}, 'Arrives'), el('dd', { class: 'mono' }, `${s.to} D${s.arr_day} ${s.arr}`),
        el('dt', {}, 'Run time'), el('dd', {}, M.dur(s.run)),
        el('dt', {}, 'Comes from'), el('dd', {}, `${prev.train_no} · halt ${M.dur(prev.haltAfter.mins)} at ${s.from}`),
        el('dt', {}, 'Next working'), el('dd', {}, `${s.haltAfter.next.train_no} · halt ${M.dur(s.haltAfter.mins)} at ${s.to}`),
        s.sheet ? el('dt', {}, 'Sheet dep') : null, s.sheet ? el('dd', {}, sheetCell(s.sheet.dep, s.dep)) : null,
        s.sheet ? el('dt', {}, 'Sheet arr') : null, s.sheet ? el('dd', {}, sheetCell(s.sheet.arr, s.arr)) : null,
      ),
    ));
  }

  /* ---------- selection ---------- */
  function select(sel) {
    state.sel = sel;
    renderSide();
    paint();
    if (sel && sel.type === 'svc') {
      const ln = lines.find((l) => l.s.train_no === sel.train);
      ln && map.fitBounds(ln.pl.getBounds(), { padding: [60, 60], maxZoom: 10 });
      const s = state.model.services.find((x) => x.train_no === sel.train);
      if (s && !state.playing) setTime(s.depAbs);
    }
  }
  $('#clearSel').addEventListener('click', () => select(null));

  function paint() {
    const sel = state.sel;
    const hit = (s) => !sel || (sel.type === 'svc' ? s.train_no === sel.train : s.from === sel.code || s.to === sel.code);
    lines.forEach(({ s, pl, casing }) => {
      const on = hit(s);
      pl.setStyle({ opacity: on ? .95 : .15, weight: sel && on ? 7 : 5 });
      casing.setStyle({ opacity: on ? .9 : .15 });
      if (on && sel) pl.bringToFront();
    });
    document.querySelectorAll('.seg').forEach((n) => n.classList.toggle('sel', !!sel && sel.type === 'svc' && n.dataset.train === sel.train));
    document.querySelectorAll('.node').forEach((n) => n.classList.toggle('sel', !!sel && sel.type === 'stn' && n.dataset.stn === sel.code));
    document.querySelectorAll('#timeline .run').forEach((g) => {
      const s = state.model.services.find((x) => x.train_no === g.dataset.train);
      g.classList.toggle('sel', !!sel && sel.type === 'svc' && hit(s));
      g.style.opacity = !sel || hit(s) ? 1 : .3;
    });
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
