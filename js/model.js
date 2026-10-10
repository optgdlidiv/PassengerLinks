/* Rake link model: one continuous link, timed over the days of its cycle. No DOM here. */
(function (global) {
  const DAY = 1440;

  const toMin = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const hhmm = (min) => {
    const m = ((Math.round(min) % DAY) + DAY) % DAY;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  };
  const dur = (min) => {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  };
  /* absolute minute → "D1 08:30" */
  const stamp = (abs) => `D${Math.floor(abs / DAY) + 1} ${hhmm(abs)}`;

  /*
   * Build the link in order. Day 1 starts at 00:00 = minute 0.
   * Returns services with absolute times, halts between them (the last halt
   * wraps to the start of the next cycle), cycle length and visited stations.
   */
  function build(link) {
    const svcs = link.services
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((s) => {
        const depAbs = (s.dep_day - 1) * DAY + toMin(s.dep);
        const arrAbs = (s.arr_day - 1) * DAY + toMin(s.arr);
        return { ...s, depAbs, arrAbs, run: arrAbs - depAbs };
      });
    const first = svcs[0], last = svcs[svcs.length - 1];
    // cycle: smallest whole number of days after which the first departure follows the last arrival
    let days = 1;
    while (first.depAbs + days * DAY < last.arrAbs) days++;
    const cycle = days * DAY;
    const halts = svcs.map((s, i) => {
      const nx = svcs[i + 1];
      const toAbs = nx ? nx.depAbs : first.depAbs + cycle;
      const next = nx || first;
      const ecr = s.to !== next.from ? { from: s.to, to: next.from, note: s.ecr_after ? s.ecr_after.note : '' } : null;
      return { at: s.to, fromAbs: s.arrAbs, toAbs, mins: toAbs - s.arrAbs, next, wraps: !nx, ecr };
    });
    svcs.forEach((s, i) => { s.haltAfter = halts[i]; });
    const closed = last.to === first.from;
    // stations in working order; an empty-rake move adds the station the rake is moved to
    const route = [{ code: first.from }];
    svcs.forEach((s, i) => {
      route.push({ code: s.to, svc: s });
      if (halts[i].ecr && svcs[i + 1]) route.push({ code: halts[i].ecr.to, ecr: true });
    });
    return { services: svcs, halts, days, cycle, closed, route, start: first.depAbs };
  }

  /* where the rake is at cycle minute t (0 … cycle) */
  function positionAt(model, t) {
    const c = model.cycle;
    const tt = ((t % c) + c) % c;
    for (const s of model.services) {
      if (inSpan(tt, s.depAbs, s.arrAbs, c)) return { state: 'run', svc: s, frac: span(s.depAbs, tt, c) / (s.run || 1) };
    }
    for (const h of model.halts) {
      if (inSpan(tt, h.fromAbs, h.toAbs, c)) return { state: 'halt', at: h.at, halt: h };
    }
    return { state: 'halt', at: model.services[0].from, halt: model.halts[model.halts.length - 1] };
  }
  const span = (a, b, c) => (((b - a) % c) + c) % c;
  const inSpan = (t, a, b, c) => span(a, t, c) < span(a, b, c);

  global.RakeModel = { DAY, toMin, hhmm, dur, stamp, build, positionAt };
})(window);
