/* Rake link model: time maths, rake cycles, positions. No DOM here. */
(function (global) {
  const DAY = 1440;

  const toMin = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const fmt = (min) => {
    const m = ((Math.round(min) % DAY) + DAY) % DAY;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  };
  const dur = (min) => {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  };
  /* minutes from a to b going forward on the 24h clock */
  const gap = (a, b) => ((b - a) % DAY + DAY) % DAY;

  function prepare(services) {
    return services.map((s) => {
      const d = toMin(s.dep), a = toMin(s.arr);
      return { ...s, depMin: d, arrMin: a, run: gap(d, a), overnight: a < d };
    });
  }

  /*
   * Chain services into rake cycles: from each arrival, the next working is the
   * service leaving the same station soonest after arrival.
   * Each cycle is rotated to begin after its longest halt.
   */
  function buildCycles(services) {
    const left = services.slice();
    const cycles = [];
    while (left.length) {
      const first = left.shift();
      const chain = [first];
      let cur = first;
      for (;;) {
        const cands = left.filter((s) => s.from === cur.to);
        if (!cands.length) break;
        cands.sort((x, y) => gap(cur.arrMin, x.depMin) - gap(cur.arrMin, y.depMin));
        const nx = cands[0];
        left.splice(left.indexOf(nx), 1);
        chain.push(nx);
        cur = nx;
      }
      const closed = chain[chain.length - 1].to === chain[0].from;
      // halts after each service (last one wraps to first if closed)
      let halts = chain.map((s, i) => {
        const nx = chain[i + 1] || (closed ? chain[0] : null);
        return nx ? { at: s.to, from: s.arrMin, to: nx.depMin, mins: gap(s.arrMin, nx.depMin) } : null;
      });
      // rotate so the cycle starts after the longest halt
      let rot = 0;
      if (closed) {
        let best = -1;
        halts.forEach((h, i) => { if (h.mins > best) { best = h.mins; rot = (i + 1) % chain.length; } });
      }
      const order = chain.slice(rot).concat(chain.slice(0, rot));
      halts = halts.slice(rot).concat(halts.slice(0, rot));
      const runMins = order.reduce((t, s) => t + s.run, 0);
      const haltMins = halts.reduce((t, h) => t + (h ? h.mins : 0), 0);
      const span = runMins + haltMins;
      cycles.push({
        services: order,
        halts,
        closed,
        runMins,
        haltMins,
        days: closed ? Math.max(1, Math.round(span / DAY)) : null,
        longestHalt: halts.filter(Boolean).sort((a, b) => b.mins - a.mins)[0] || null,
      });
    }
    cycles.forEach((c, i) => {
      c.id = i;
      c.name = 'Rake ' + String.fromCharCode(65 + i);
      c.services.forEach((s, j) => {
        s.rake = i;
        const nx = c.services[j + 1] || (c.closed ? c.services[0] : null);
        s.next = nx ? nx.train_no : null;
        s.haltAfter = c.halts[j];
      });
    });
    return cycles;
  }

  const inWindow = (t, from, to) => (from <= to ? t >= from && t < to : t >= from || t < to);

  /* where is each rake at minute t → {state:'run', svc, frac} | {state:'halt', at, halt} */
  function rakeAt(cycle, t) {
    for (const s of cycle.services) {
      if (inWindow(t, s.depMin, s.arrMin)) {
        return { state: 'run', svc: s, frac: gap(s.depMin, t) / (s.run || 1) };
      }
    }
    for (const h of cycle.halts) {
      if (h && inWindow(t, h.from, h.to)) return { state: 'halt', at: h.at, halt: h };
    }
    // open chain: before first departure sits at origin, after last arrival at destination
    const last = cycle.services[cycle.services.length - 1];
    const first = cycle.services[0];
    return gap(last.arrMin, t) < gap(t, first.depMin)
      ? { state: 'halt', at: last.to, halt: null }
      : { state: 'halt', at: first.from, halt: null };
  }

  global.RakeModel = { DAY, toMin, fmt, dur, gap, prepare, buildCycles, rakeAt, inWindow };
})(window);
