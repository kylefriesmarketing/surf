// SURF — the front end: title, tour, break select, results, stats.
//
// This module BUILDS ITS OWN DOM and injects its own stylesheet, rather than living
// in index.html. That is deliberate: index.html and the render layer are being
// worked on in parallel, and a front end that owns its own markup cannot collide
// with an art pass. It also means every screen is one function with its data next
// to it instead of a hundred lines of HTML kept in sync by hand.
//
// Pure presentation. It knows about career/heat SHAPES (breaks.js) but holds no
// game state — everything comes in as arguments and goes out through callbacks.

const CSS = `
#ui{position:fixed;inset:0;z-index:40;display:none;overflow-y:auto;
    background:radial-gradient(ellipse at 50% 38%,rgba(6,20,30,.62),rgba(4,12,20,.95));
    backdrop-filter:blur(5px);
    font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;color:#f4f7fa}
#ui.on{display:block}
#ui .wrap{min-height:100%;display:flex;flex-direction:column;align-items:center;
          justify-content:center;padding:44px 26px;text-align:center}
#ui h1{font-size:clamp(44px,10vw,96px);font-weight:100;letter-spacing:.38em;
       margin-left:.38em;margin-bottom:4px;line-height:1}
#ui .tag{font-size:11.5px;letter-spacing:.30em;color:rgba(244,247,250,.5);margin-bottom:34px}
#ui h2{font-size:13px;letter-spacing:.32em;color:rgba(244,247,250,.55);
       font-weight:400;margin-bottom:22px}
#ui .menu{display:flex;flex-direction:column;gap:13px;width:min(420px,88vw)}
#ui button{font:inherit;color:inherit;background:rgba(255,255,255,.045);
  border:1px solid rgba(244,247,250,.16);border-radius:9px;padding:15px 20px;
  letter-spacing:.20em;font-size:12.5px;cursor:pointer;transition:.16s;
  text-align:left;display:flex;justify-content:space-between;align-items:center;gap:14px}
#ui button:hover:not(:disabled){background:rgba(255,255,255,.11);
  border-color:rgba(244,247,250,.4);transform:translateY(-1px)}
#ui button:disabled{opacity:.34;cursor:not-allowed}
#ui button .r{color:#ffd9a8;letter-spacing:.1em;font-size:11.5px;white-space:nowrap}
#ui button .sub{display:block;font-size:10px;letter-spacing:.13em;
  color:rgba(244,247,250,.45);margin-top:5px;text-transform:none}
#ui .primary{background:rgba(255,217,168,.13);border-color:rgba(255,217,168,.45)}
#ui .back{margin-top:26px;opacity:.6;font-size:11px;letter-spacing:.26em;
  background:none;border:none;justify-content:center}
#ui .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));
  gap:11px;width:min(760px,92vw);text-align:left}
#ui .stat{border:1px solid rgba(244,247,250,.13);border-radius:9px;padding:14px 16px}
#ui .stat .k{font-size:9.5px;letter-spacing:.2em;color:rgba(244,247,250,.45)}
#ui .stat .v{font-size:25px;font-weight:200;margin-top:5px;font-variant-numeric:tabular-nums}
#ui .goals{list-style:none;margin:16px 0 0;width:min(430px,88vw);text-align:left}
#ui .goals li{display:flex;justify-content:space-between;gap:12px;padding:9px 2px;
  font-size:11.5px;letter-spacing:.11em;border-bottom:1px solid rgba(244,247,250,.09);
  color:rgba(244,247,250,.62)}
#ui .goals li.met{color:#7fe3b0}
#ui .goals li .n{font-variant-numeric:tabular-nums;opacity:.75}
#ui .stars{color:#ffd9a8;letter-spacing:.18em;font-size:13px}
#ui .dim{color:rgba(244,247,250,.34)}
#ui .big{font-size:clamp(46px,12vw,92px);font-weight:100;line-height:1;
  font-variant-numeric:tabular-nums;margin:6px 0 4px}
#ui .blurb{font-size:11px;letter-spacing:.1em;line-height:2;
  color:rgba(244,247,250,.5);max-width:520px;margin:0 auto 26px}
#ui .heatrow{display:flex;justify-content:space-between;width:min(520px,90vw);
  font-size:11px;letter-spacing:.14em;color:rgba(244,247,250,.55);
  padding:7px 2px;border-bottom:1px solid rgba(244,247,250,.08)}
#ui .heatrow b{color:#f4f7fa;font-weight:500}
`;

export class UI {
  constructor(root = document.body) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.id = 'ui';
    this.el.innerHTML = '<div class="wrap"></div>';
    root.appendChild(this.el);
    this.wrap = this.el.querySelector('.wrap');
    this.onKey = null;
    addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape' && this.escape) { e.preventDefault(); this.escape(); }
    });
  }

  isOpen() { return this.el.classList.contains('on'); }
  hide() { this.el.classList.remove('on'); this.escape = null; }

  /** Render a screen. `nodes` is an array of elements or html strings. */
  show(nodes) {
    this.wrap.innerHTML = '';
    for (const n of nodes) {
      if (typeof n === 'string') { const d = document.createElement('div'); d.innerHTML = n; this.wrap.appendChild(d.firstElementChild || d); }
      else this.wrap.appendChild(n);
    }
    this.el.classList.add('on');
    this.el.scrollTop = 0;
  }

  btn(label, sub, right, onClick, opts = {}) {
    const b = document.createElement('button');
    if (opts.primary) b.className = 'primary';
    if (opts.disabled) b.disabled = true;
    b.innerHTML = `<span>${label}${sub ? `<span class="sub">${sub}</span>` : ''}</span>` +
                  (right ? `<span class="r">${right}</span>` : '');
    if (!opts.disabled) b.onclick = onClick;
    return b;
  }

  menu(children) {
    const m = document.createElement('div');
    m.className = 'menu';
    for (const c of children) m.appendChild(c);
    return m;
  }

  back(label, fn) {
    const b = this.btn(label, null, null, fn);
    b.className = 'back';
    this.escape = fn;
    return b;
  }
}

const stars = (n, of) => '★'.repeat(n) + '<span class="dim">' + '★'.repeat(Math.max(0, of - n)) + '</span>';

// ---------------------------------------------------------------- screens

export function homeScreen(ui, career, cb) {
  const any = career.stars > 0;
  ui.show([
    '<h1>SURF</h1>',
    `<div class="tag">${any ? `${career.stars} STARS · BEST SET ${career.bestSet.toLocaleString()}` : 'ONE WAVE AT A TIME'}</div>`,
    ui.menu([
      ui.btn('THE TOUR', 'eight heats, four breaks', `${career.stars}★`, cb.tour, { primary: true }),
      ui.btn('FREE SURF', 'any wave you have unlocked', null, cb.free),
      ui.btn('CONTEST', 'one heat, one rival, two best waves count', null, cb.contest),
      ui.btn('RECORDS', 'everything you have ever done', null, cb.stats),
    ]),
    '<div class="blurb" style="margin-top:30px">A·D carve · SPACE pump · SHIFT tuck · R next wave · M mute</div>',
  ]);
}

export function tourScreen(ui, TOUR, career, B, cb) {
  const rows = TOUR.map((h, i) => {
    const rec = career.heats[h.id];
    const open = B.heatUnlocked(career, i);
    const br = B.byId(h.breakId);
    return ui.btn(
      `${h.name}`,
      `${br.name} · ${h.waves} waves` + (open ? '' : ` · needs ${B.starsToUnlock(i)}★`),
      open ? stars(rec ? rec.stars : 0, h.goals.length) : '🔒',
      () => cb.play(h, i),
      { disabled: !open, primary: open && !rec });
  });
  ui.show([
    '<h2>THE TOUR</h2>',
    `<div class="tag">${career.stars} STARS EARNED</div>`,
    ui.menu(rows),
    ui.back('← BACK', cb.back),
  ]);
}

// What each medium asks of you, one line each, shown under the picker.
const ELEMENT_NOTES = {
  water:  'the baseline — everything else bends it',
  lava:   'slow and heavy · the crust does not forgive',
  sand:   'loose rails, everything is a drift',
  snow:   'fast and clean · edges bite hard',
  cosmic: 'low gravity · airs last long enough to think in',
};

export function breakScreen(ui, BREAKS, career, B, E, elementId, cb) {
  // The element picker: a chip row above the break list. Elements unlock on the
  // same star ladder as everything else — water free, then one every few stars.
  const gates = { water: 0, sand: 2, snow: 4, lava: 6, cosmic: 9 };
  const chips = document.createElement('div');
  chips.className = 'menu';
  chips.style.flexDirection = 'row';
  chips.style.flexWrap = 'wrap';
  chips.style.justifyContent = 'center';
  for (const elm of E.LIST) {
    const locked = career.stars < (gates[elm.id] ?? 0);
    const c = ui.btn(elm.name, null, locked ? `${gates[elm.id]}★` : null,
      () => cb.pick(elm.id), { disabled: locked, primary: elm.id === elementId });
    c.style.flex = '0 1 auto';
    c.style.padding = '10px 16px';
    chips.appendChild(c);
  }
  const note = `<div class="tag" style="margin-top:14px">${ELEMENT_NOTES[elementId] || ''}</div>`;

  const rows = BREAKS.map((b) => {
    const open = B.breakUnlocked(career, b);
    return ui.btn(b.name, `${b.sub} · ${b.waves.length} waves`,
      open ? `${b.waves.length}` : `needs ${B.starsToUnlock(b.unlockAt)}★`,
      () => cb.play(b, elementId), { disabled: !open });
  });
  ui.show(['<h2>FREE SURF</h2>', chips, note, ui.menu(rows), ui.back('← BACK', cb.back)]);
}

export function contestScreen(ui, RIVALS, BREAKS, career, B, cb) {
  const open = BREAKS.filter((b) => B.breakUnlocked(career, b));
  const rows = RIVALS.map((r, i) => {
    const locked = career.stars < i * 3;
    return ui.btn(r.name, r.tag, locked ? `needs ${i * 3}★` : 'SURF OFF',
      () => cb.play(r, open[Math.min(open.length - 1, Math.floor(i / 1.5))]),
      { disabled: locked, primary: !locked && i === 0 });
  });
  ui.show([
    '<h2>CONTEST</h2>',
    '<div class="blurb">Two waves each. Only your two best count, so a wave you have '
    + 'already beaten is worth nothing — and a fifth wave you did not need is how '
    + 'people lose heats.</div>',
    ui.menu(rows),
    ui.back('← BACK', cb.back),
  ]);
}

export function statsScreen(ui, career, TOUR, cb) {
  const L = career.lifetime;
  const cell = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.innerHTML =
    cell('WAVES RIDDEN', L.waves) +
    cell('DISTANCE', `${(L.dist / 1000).toFixed(2)} km`) +
    cell('BARREL TIME', `${L.barrel.toFixed(1)} s`) +
    cell('TUBES MADE', L.tubes) +
    cell('MANOEUVRES', L.tricks) +
    cell('AIRS LANDED', L.airs) +
    cell('WIPEOUTS', L.wipeouts) +
    cell('TOP SPEED', `${(L.topSpeed * 3.6).toFixed(0)} km/h`) +
    cell('BEST SET', career.bestSet.toLocaleString()) +
    cell('STARS', `${career.stars} / ${TOUR.reduce((a, h) => a + h.goals.length, 0)}`);
  ui.show(['<h2>RECORDS</h2>', grid, ui.back('← BACK', cb.back)]);
}

export function resultsScreen(ui, heat, results, totals, earned, cb) {
  const got = results.filter((r) => r.met).length;
  const list = document.createElement('ul');
  list.className = 'goals';
  list.innerHTML = results.map((r) => {
    const shown = r.type === 'barrel' ? `${r.got.toFixed(1)}` :
                  r.type === 'speed' ? `${Math.round(r.got)}` : Math.round(r.got);
    return `<li class="${r.met ? 'met' : ''}"><span>${r.met ? '✓' : '·'} ${r.label}</span>` +
           `<span class="n">${shown.toLocaleString?.() ?? shown} / ${r.target.toLocaleString()}</span></li>`;
  }).join('');
  ui.show([
    `<h2>${heat.name}</h2>`,
    `<div class="big">${Math.round(totals.total).toLocaleString()}</div>`,
    `<div class="stars">${stars(got, results.length)}</div>`,
    list,
    ui.menu([
      ui.btn('SURF IT AGAIN', null, null, cb.retry, { primary: got < results.length }),
      ui.btn('BACK TO THE TOUR', null, null, cb.tour, { primary: got === results.length }),
    ]),
  ]);
}

export function contestResults(ui, rival, you, them, cb) {
  const win = you.total > them.total;
  const rows = (label, s) => `<div class="heatrow"><span>${label}</span>` +
    `<span>${s.waves.map((w) => w.toFixed(1)).join('  ·  ')} &nbsp; <b>${s.total.toFixed(1)}</b></span></div>`;
  ui.show([
    `<h2>${win ? 'HEAT WON' : 'HEAT LOST'}</h2>`,
    `<div class="big" style="color:${win ? '#7fe3b0' : '#ff7a55'}">${you.total.toFixed(1)}</div>`,
    `<div class="tag">${rival.name} SCORED ${them.total.toFixed(1)}</div>`,
    `<div style="width:min(520px,90vw);margin-top:10px">${rows('YOU', you)}${rows(rival.name, them)}</div>`,
    '<div class="blurb" style="margin-top:22px">Only the two best waves count.</div>',
    ui.menu([
      ui.btn('REMATCH', null, null, cb.retry, { primary: !win }),
      ui.btn('BACK', null, null, cb.back, { primary: win }),
    ]),
  ]);
}
