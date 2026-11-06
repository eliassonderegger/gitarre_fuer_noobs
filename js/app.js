(() => {
"use strict";
const SONGS = window.SONGS || [];
/* ---------- Musik-Grundlagen ---------- */
const TUNING = [64, 59, 55, 50, 45, 40];               // Saite 1..6: E4 B3 G3 D3 A2 E2 (klingend)
const NN = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const nameOf = m => NN[m % 12] + (Math.floor(m / 12) - 1);
const ROLE = { m: "melody", h: "harmony", b: "bass" };
const ROLE_DE = { melody: "Melodie", harmony: "Harmonie", bass: "Bass" };
const TECH_DE = { s: "Slide", h: "Hammer-on", p: "Pull-off" };
const ROLE_GAIN = { melody: 1.0, harmony: 0.55, bass: 0.85 };

/* ---------- Zustand ---------- */
const DEFAULTS = { bpm: 56, mode: "all", repeats: true, metro: false, countIn: true, showNext: true, showRing: true, names: true, muted: { melody:false, harmony:false, bass:false } };
let saved = {};
try { saved = JSON.parse(localStorage.getItem("gtt-settings") || "{}") || {}; } catch (e) { saved = {}; }
const state = Object.assign({}, DEFAULTS, saved, { muted: Object.assign({}, DEFAULTS.muted, saved.muted || {}) });
state.pos = 0;
let song = SONGS[0];
let seq = [], blocks = [], measureLock = 0;
function persist() {
  try {
    const { bpm, mode, repeats, metro, countIn, showNext, showRing, names, muted } = state;
    localStorage.setItem("gtt-settings", JSON.stringify({ bpm, mode, repeats, metro, countIn, showNext, showRing, names, muted }));
  } catch (e) {}
}

const sectionOf = mi => Object.keys(song.sections).find(k => song.sections[k].measures.includes(mi));
const evOf = ref => song.measures[ref.m][ref.e];

function buildSeq() {
  const s = [];
  let bl;
  if (state.mode === "A") bl = ["A"];
  else if (state.mode === "B") bl = ["B"];
  else if (state.mode === "measure") bl = null;
  else bl = state.repeats ? song.form : song.formShort;
  if (!bl) {
    song.measures[measureLock].forEach((ev, e) => s.push({ m: measureLock, e, block: 0 }));
    blocks = [{ label: "T" + (measureLock + 1), sub: "Schleife" }];
  } else {
    bl.forEach((b, bi) => song.sections[b].measures.forEach(m => song.measures[m].forEach((ev, e) => s.push({ m, e, block: bi }))));
    blocks = bl.map(b => { const ms = song.sections[b].measures; return { label: b, sub: "T " + (ms[0] + 1) + "–" + (ms[ms.length - 1] + 1) }; });
  }
  return s;
}
function rebuildSeq() {
  const cur = seq[state.pos];
  seq = buildSeq();
  let idx = cur ? seq.findIndex(r => r.m === cur.m && r.e === cur.e) : 0;
  state.pos = Math.max(0, idx);
}
const isLoop = () => state.mode !== "all";

/* ---------- Audio: gezupfte Saite (Karplus-Strong) ---------- */
let ctx = null, master, clickBus;
const bufCache = new Map();
const voices = new Array(7).fill(null);
const active = new Set();

function ensureAudio() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 3; comp.connect(ctx.destination);
  master = ctx.createGain(); master.gain.value = 0.85;
  const body = ctx.createBiquadFilter(); body.type = "peaking"; body.frequency.value = 190; body.Q.value = 1.1; body.gain.value = 4;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 4300; lp.Q.value = 0.6;
  master.connect(body); body.connect(lp); lp.connect(comp);
  const verb = ctx.createConvolver(); verb.buffer = makeIR(2.0);
  const wet = ctx.createGain(); wet.gain.value = 0.2;
  lp.connect(verb); verb.connect(wet); wet.connect(comp);
  clickBus = ctx.createGain(); clickBus.gain.value = 0.45; clickBus.connect(comp);
}
function makeIR(sec) {
  const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4); }
  return b;
}
function ksBuf(midi) {
  if (bufCache.has(midi)) return bufCache.get(midi);
  const sr = ctx.sampleRate, f = 440 * Math.pow(2, (midi - 69) / 12);
  const N = Math.max(4, Math.floor(sr / f - 0.5)), f0 = sr / (N + 0.5);
  const T60 = Math.max(1.6, 4.2 - (midi - 40) * 0.07);
  const rho = Math.pow(0.001, 1 / (f0 * T60));
  const len = Math.floor(sr * Math.min(5, T60 + 0.6));
  const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
  const ring = new Float32Array(N);
  let p = 0;
  for (let i = 0; i < N; i++) { p += 0.55 * ((Math.random() * 2 - 1) - p); ring[i] = p; }
  let mean = 0; for (let i = 0; i < N; i++) mean += ring[i]; mean /= N;
  for (let i = 0; i < N; i++) ring[i] -= mean;
  let idx = 0, peak = 0;
  for (let n = 0; n < len; n++) {
    const a = ring[idx], b = ring[(idx + 1) % N];
    d[n] = a; if (n < N * 4) peak = Math.max(peak, Math.abs(a));
    ring[idx] = rho * 0.5 * (a + b);
    idx = (idx + 1) % N;
  }
  const k = 0.55 / (peak || 1);
  for (let n = 0; n < len; n++) d[n] *= k;
  const out = { buf, rate: f / f0 };
  bufCache.set(midi, out);
  return out;
}
function playNote(s, midi, t, gain, legato) {
  const { buf, rate } = ksBuf(midi);
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
  const g = ctx.createGain(); const a = gain * (legato ? 0.6 : 1);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.004);
  src.connect(g); g.connect(master); src.start(t);
  const v = { src, g };
  active.add(v); src.onended = () => active.delete(v);
  const prev = voices[s];
  if (prev) { prev.g.gain.cancelScheduledValues(t); prev.g.gain.setTargetAtTime(0, t, 0.012); try { prev.src.stop(t + 0.15); } catch (e) {} }
  voices[s] = v;
}
function killAll() {
  if (!ctx) return;
  const now = ctx.currentTime;
  active.forEach(v => { try { v.g.gain.cancelScheduledValues(now); v.g.gain.setValueAtTime(v.g.gain.value, now); v.g.gain.setTargetAtTime(0, now, 0.03); v.src.stop(now + 0.3); } catch (e) {} });
  voices.fill(null);
}
function click(t, accent) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1700 : 1150;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(accent ? 0.55 : 0.32, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g); g.connect(clickBus); o.start(t); o.stop(t + 0.06);
}
function playEvent(ev, t) {
  ev.notes.forEach(n => { if (!state.muted[n.role]) playNote(n.s, n.midi, t, ROLE_GAIN[n.role], !!n.tech); });
}

/* ---------- Abspiel-Engine ---------- */
let playing = false, timer = null, raf = 0, nextIdx = 0, nextTime = 0, queue = [], endAt = null;
const eighth = () => 30 / state.bpm;

function play(withCountIn = state.countIn) {
  ensureAudio();
  if (playing) return;
  if (!isLoop() && state.pos >= seq.length - 1) state.pos = 0;
  playing = true; queue = []; endAt = null; nextIdx = state.pos;
  let t = ctx.currentTime + 0.08;
  if (withCountIn) { const q = 2 * eighth(); for (let i = 0; i < song.beats; i++) click(t + i * q, i === 0); t += song.beats * q; }
  nextTime = t;
  scheduler(); timer = setInterval(scheduler, 25);
  raf = requestAnimationFrame(tick);
  updatePlayBtn();
}
function scheduler() {
  if (!playing) return;
  while (nextTime < ctx.currentTime + 0.15) {
    if (nextIdx >= seq.length) { if (isLoop()) nextIdx = 0; else { endAt = nextTime; break; } }
    const ev = evOf(seq[nextIdx]);
    playEvent(ev, nextTime);
    if (state.metro) {
      for (let k = Math.ceil(ev.pos / 2) * 2; k < ev.pos + ev.dur; k += 2) click(nextTime + (k - ev.pos) * eighth(), k === 0);
    }
    queue.push({ i: nextIdx, t: nextTime });
    nextTime += ev.dur * eighth();
    nextIdx++;
  }
}
function tick() {
  if (!playing) return;
  const now = ctx.currentTime; let changed = false;
  while (queue.length && queue[0].t <= now + 0.01) { state.pos = queue.shift().i; changed = true; }
  if (changed) render();
  if (endAt !== null && now >= endAt + 0.1) { stop(false); return; }
  raf = requestAnimationFrame(tick);
}
function stop(kill = true) {
  playing = false; clearInterval(timer); cancelAnimationFrame(raf); queue = [];
  if (kill) killAll();
  updatePlayBtn();
}
function toggle() { playing ? stop(true) : play(); }
function restartIfPlaying(fn) { const was = playing; if (was) stop(true); fn(); render(); if (was) play(false); }
function previewCurrent() { ensureAudio(); playEvent(evOf(seq[state.pos]), ctx.currentTime + 0.01); }
function step(d) {
  if (playing) stop(true);
  state.pos = (state.pos + d + seq.length) % seq.length;
  render(); previewCurrent();
}
function jumpTo(m, e) {
  const was = playing; if (was) stop(true);
  if (state.mode === "measure" && measureLock !== m) { measureLock = m; seq = buildSeq(); }
  let idx = findIdx(m, e);
  if (idx < 0) { state.mode = state.mode === "all-loop" ? "all-loop" : "all"; modeSel.value = state.mode; seq = buildSeq(); idx = findIdx(m, e); persist(); }
  state.pos = Math.max(0, idx);
  render();
  if (was) play(false); else previewCurrent();
}
function findIdx(m, e) {
  const curBlock = seq[state.pos] ? seq[state.pos].block : 0;
  let i = seq.findIndex(r => r.m === m && r.e === e && r.block === curBlock);
  if (i < 0) i = seq.findIndex((r, k) => k >= state.pos && r.m === m && r.e === e);
  if (i < 0) i = seq.findIndex(r => r.m === m && r.e === e);
  return i;
}

/* ---------- Griffbrett ---------- */
const svgNS = "http://www.w3.org/2000/svg";
const BX0 = 124, FL = 1790, SY0 = 58, SDY = 40, FRETS = 15;
const fx = n => BX0 + FL * (1 - Math.pow(2, -n / 12));
const noteX = f => f === 0 ? BX0 - 26 : (fx(f - 1) + fx(f)) / 2;
const sy = s => SY0 + (s - 1) * SDY;
const BOARD_ROLE = { melody: "#c65a32", harmony: "#2f8578", bass: "#a8843c" };
const board = document.getElementById("board");

function buildBoard() {
  const end = 1186;
  let h = `<defs>
    <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a281d"/><stop offset=".5" stop-color="#2d1f16"/><stop offset="1" stop-color="#241810"/></linearGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1d15"/><stop offset="1" stop-color="#1b120d"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="0" y="0" width="1200" height="322" rx="20" fill="url(#frame)"/>
  <rect x="${BX0}" y="34" width="${end - BX0}" height="248" fill="url(#wood)"/>`;
  // Holzmaserung
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 16; i++) {
    const y = 40 + rnd() * 236, a = (rnd() - .5) * 8;
    h += `<path d="M${BX0} ${y} C ${BX0 + 300} ${y + a}, ${BX0 + 700} ${y - a}, ${end} ${y + a / 2}" stroke="#5a3f2c" stroke-opacity="${(0.08 + rnd() * 0.12).toFixed(2)}" stroke-width="${(0.6 + rnd() * 1.4).toFixed(1)}" fill="none"/>`;
  }
  // Einlagen
  const inlay = (f, y) => h += `<circle cx="${noteX(f)}" cy="${y}" r="6.5" fill="#d8c9b0" fill-opacity=".5"/>`;
  [3, 5, 7, 9, 15].forEach(f => inlay(f, (sy(3) + sy(4)) / 2));
  inlay(12, (sy(2) + sy(3)) / 2); inlay(12, (sy(4) + sy(5)) / 2);
  // Bünde
  for (let n = 1; n <= FRETS; n++) {
    const x = fx(n);
    h += `<line x1="${x}" x2="${x}" y1="36" y2="280" stroke="#a89a88" stroke-width="3.2"/><line x1="${x - 0.8}" x2="${x - 0.8}" y1="36" y2="280" stroke="#e6dccd" stroke-width="1" stroke-opacity=".7"/>`;
  }
  // Sattel
  h += `<rect x="${BX0 - 7}" y="32" width="9" height="252" rx="2" fill="#efe6d6"/>`;
  // Saiten
  const widths = [1.3, 1.6, 2.0, 2.4, 2.9, 3.4];
  const colors = ["#ece4d8", "#e4dacb", "#dbd0bf", "#c9a35d", "#c39a52", "#b98f47"];
  for (let s = 1; s <= 6; s++) {
    h += `<line x1="${BX0 - 2}" x2="${end}" y1="${sy(s)}" y2="${sy(s)}" stroke="${colors[s - 1]}" stroke-width="${widths[s - 1]}"/>`;
    h += `<text x="20" y="${sy(s) + 6}" fill="#e9dfd1" font-size="19" font-weight="500">${"①②③④⑤⑥"[s - 1]}</text>`;
    h += `<text x="46" y="${sy(s) + 6}" fill="#e9dfd1" font-size="17" font-weight="700">${"EBGDAE"[s - 1]}</text>`;
  }
  // Bundzahlen
  h += `<text x="${noteX(0)}" y="308" fill="#bfb2a2" font-size="13" text-anchor="middle">Leer</text>`;
  for (let n = 1; n <= FRETS; n++) h += `<text x="${noteX(n)}" y="308" fill="#bfb2a2" font-size="13" text-anchor="middle">${n}</text>`;
  // Klickflächen
  for (let s = 1; s <= 6; s++) for (let f = 0; f <= FRETS; f++) {
    const x0 = f === 0 ? BX0 - 48 : fx(f - 1), x1 = f === 0 ? BX0 : fx(f);
    h += `<rect class="hit" data-s="${s}" data-f="${f}" x="${x0}" y="${sy(s) - SDY / 2}" width="${x1 - x0}" height="${SDY}" fill="transparent"><title>Saite ${s}, Bund ${f}: ${nameOf(TUNING[s - 1] + f)}</title></rect>`;
  }
  h += `<g id="mkLayer" pointer-events="none"></g><g id="probeLayer" pointer-events="none"></g>`;
  board.innerHTML = h;
}

function markerSVG(n, kind, muted) {
  const x = noteX(n.f), y = sy(n.s), c = BOARD_ROLE[n.role];
  const label = state.names ? `<text x="19" y="-15" font-size="12.5" font-weight="700" fill="#f6ede1" stroke="#1d140e" stroke-width="3.5" paint-order="stroke">${nameOf(n.midi)}</text>` : "";
  if (kind === "ghost") return `<g transform="translate(${x},${y})" opacity=".9"><circle r="14" fill="none" stroke="${c}" stroke-width="2.2" stroke-dasharray="4 3"/></g>`;
  if (kind === "ring") return `<g transform="translate(${x},${y})" opacity=".55"><circle r="12.5" fill="${c}" opacity=".7"/><text text-anchor="middle" dy="4.5" font-size="12" font-weight="700" fill="#f6ede1">${n.f}</text></g>`;
  return `<g class="mk fresh" transform="translate(${x},${y})" opacity="${muted ? .45 : 1}">
    <circle r="30" fill="url(#glow)"/>
    <circle class="halo" r="16" fill="none" stroke="${c}" stroke-width="3"/>
    <circle r="16" fill="${c}" stroke="#fbf6ee" stroke-width="2.6" ${muted ? 'stroke-dasharray="4 3"' : ""}/>
    <text text-anchor="middle" dy="5" font-size="14" font-weight="700" fill="#fff">${n.f}</text>${label}</g>`;
}
function drawMarkers(ref, ev) {
  const layer = document.getElementById("mkLayer");
  const meas = song.measures[ref.m];
  const curStrings = new Set(ev.notes.map(n => n.s));
  let h = "";
  if (state.showNext && seq.length > 1) {
    const nx = evOf(seq[(state.pos + 1) % seq.length]);
    nx.notes.forEach(n => { if (!ev.notes.some(c => c.s === n.s && c.f === n.f)) h += markerSVG(n, "ghost"); });
  }
  if (state.showRing) {
    const held = new Map();
    for (let i = 0; i < ref.e; i++) meas[i].notes.forEach(n => held.set(n.s, n));
    held.forEach((n, s) => { if (!curStrings.has(s) && !state.muted[n.role]) h += markerSVG(n, "ring"); });
  }
  ev.notes.forEach(n => h += markerSVG(n, "now", state.muted[n.role]));
  layer.innerHTML = h;
}
function probe(s, f) {
  ensureAudio();
  const n = { s, f, midi: TUNING[s - 1] + f, role: "melody" };
  playNote(s, n.midi, ctx.currentTime + 0.01, 0.9, false);
  const layer = document.getElementById("probeLayer");
  const g = document.createElementNS(svgNS, "g");
  g.innerHTML = `<g transform="translate(${noteX(f)},${sy(s)})"><circle r="16" fill="#f6ede1" stroke="#c65a32" stroke-width="2.5"/><text text-anchor="middle" dy="5" font-size="14" font-weight="700" fill="#2a1d16">${f}</text><text x="19" y="-15" font-size="12.5" font-weight="700" fill="#f6ede1" stroke="#1d140e" stroke-width="3.5" paint-order="stroke">${nameOf(n.midi)}</text></g>`;
  layer.appendChild(g);
  setTimeout(() => g.remove(), 900);
}
board.addEventListener("click", e => {
  const r = e.target.closest(".hit"); if (!r) return;
  probe(+r.dataset.s, +r.dataset.f);
});

/* ---------- Tabulatur ---------- */
const tabEl = document.getElementById("tab");
let tabRefs = [], curTab = { m: -1, e: -1 };
function buildTab() {
  tabEl.innerHTML = ""; tabRefs = [];
  const PX = 36, PL = 34, PR = 16, TOP = 30, SP = 13, H = TOP + 5 * SP + 16;
  let out = "";
  song.measures.forEach((meas, mi) => {
    const W = PL + song.eighths * PX + PR;
    const sec = sectionOf(mi), ms = song.sections[sec].measures;
    const isStart = ms[0] === mi, isEnd = ms[ms.length - 1] === mi;
    const xEnd = W - PR + 6, yA = TOP, yB = TOP + 5 * SP;
    let s = `<svg class="meas" data-m="${mi}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="Takt ${mi + 1}">`;
    s += `<rect class="mframe" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="8"/>`;
    meas.forEach((ev, ei) => {
      const w = PX * Math.min(ev.dur, 1); ev._x = PL + ev.pos * PX + w / 2;
      s += `<rect class="col" data-e="${ei}" x="${ev._x - w / 2}" y="${TOP - 13}" width="${w}" height="${5 * SP + 26}" rx="4"/>`;
    });
    for (let i = 0; i < 6; i++) {
      const y = TOP + i * SP;
      s += `<line class="sl" x1="${PL - 8}" x2="${xEnd}" y1="${y}" y2="${y}"/><text class="slab" x="8" y="${y + 3}">${"eBGDAE"[i]}</text>`;
    }
    s += `<line class="bar" x1="${PL - 8}" x2="${PL - 8}" y1="${yA}" y2="${yB}"/>`;
    s += `<line class="bar" x1="${xEnd}" x2="${xEnd}" y1="${yA}" y2="${yB}"/>`;
    if (state.repeats && isStart) {
      s += `<line class="rep" x1="${PL - 8}" x2="${PL - 8}" y1="${yA}" y2="${yB}"/><circle class="dot" cx="${PL - 1}" cy="${TOP + 2 * SP - 6.5 + 6.5}" r="2"/><circle class="dot" cx="${PL - 1}" cy="${TOP + 3 * SP}" r="2"/>`;
    }
    if (state.repeats && isEnd) {
      s += `<line class="rep" x1="${xEnd}" x2="${xEnd}" y1="${yA}" y2="${yB}"/><circle class="dot" cx="${xEnd - 7}" cy="${TOP + 2 * SP}" r="2"/><circle class="dot" cx="${xEnd - 7}" cy="${TOP + 3 * SP}" r="2"/>`;
    }
    meas.forEach((ev, ei) => ev.notes.forEach(n => {
      const y = TOP + (n.s - 1) * SP, txt = String(n.f), bw = txt.length * 7.8 + 3;
      s += `<rect class="nbg" data-e="${ei}" x="${ev._x - bw / 2}" y="${y - 6.5}" width="${bw}" height="13"/>`;
      s += `<text class="nt ${n.role}" data-e="${ei}" x="${ev._x}" y="${y + 4.3}">${txt}</text>`;
      if (n.tech) s += `<text class="tech" x="${ev._x - 10}" y="${y - 5}">${n.tech}</text>`;
    }));
    s += `<text class="mnum" x="${PL - 8}" y="13">${mi + 1}</text>`;
    if (isStart) s += `<text class="msec" x="${PL + 14}" y="13">TEIL ${sec} · ${song.sections[sec].key}</text>`;
    s += `</svg>`;
    out += s;
  });
  tabEl.innerHTML = out;
  tabEl.querySelectorAll("svg.meas").forEach(svg => { tabRefs[+svg.dataset.m] = { svg, cols: [...svg.querySelectorAll(".col")] }; });
  curTab = { m: -1, e: -1 };
}
tabEl.addEventListener("click", e => {
  const svg = e.target.closest("svg.meas"); if (!svg) return;
  const hit = e.target.closest("[data-e]");
  jumpTo(+svg.dataset.m, hit ? +hit.dataset.e : 0);
});
function highlightTab(ref) {
  if (curTab.m >= 0 && tabRefs[curTab.m]) {
    tabRefs[curTab.m].svg.classList.remove("cur");
    const c = tabRefs[curTab.m].cols[curTab.e]; if (c) c.classList.remove("cur");
  }
  const t = tabRefs[ref.m]; if (!t) return;
  t.svg.classList.add("cur"); t.cols[ref.e].classList.add("cur");
  if (curTab.m !== ref.m) {
    const top = t.svg.offsetTop, bottom = top + t.svg.offsetHeight;
    if (top < tabEl.scrollTop || bottom > tabEl.scrollTop + tabEl.clientHeight) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      tabEl.scrollTo({ top: Math.max(0, top - 8), behavior: reduce ? "auto" : "smooth" });
    }
  }
  curTab = { m: ref.m, e: ref.e };
}

/* ---------- Anzeige ---------- */
const posLabel = document.getElementById("posLabel"), nowNotes = document.getElementById("nowNotes"), formChips = document.getElementById("formChips");
function render() {
  const ref = seq[state.pos], ev = evOf(ref);
  drawMarkers(ref, ev);
  const beat = Math.floor(ev.pos / 2) + 1, off = ev.pos % 2;
  const beatTxt = off === 0 ? `Schlag ${beat}` : (off === 1 ? `Schlag ${beat} und` : `Schlag ${beat} (Zwischenton)`);
  posLabel.innerHTML = `Teil ${sectionOf(ref.m)} · Takt ${ref.m + 1} · ${beatTxt}<small>Schritt ${ref.e + 1} von ${song.measures[ref.m].length}</small>`;
  nowNotes.innerHTML = ev.notes.map(n => `<span class="nchip ${n.role}"><b>${nameOf(n.midi)}</b> Saite ${n.s} · Bund ${n.f}${n.tech ? ` <em>${TECH_DE[n.tech]}</em>` : ""}</span>`).join("");
  formChips.innerHTML = blocks.map((b, i) => `<button class="fchip${i === ref.block ? " cur" : (i < ref.block ? " done" : "")}" data-b="${i}" aria-label="Zu ${b.label} springen"><b>${b.label}</b><span>${b.sub}</span></button>`).join("");
  highlightTab(ref);
}
formChips.addEventListener("click", e => {
  const b = e.target.closest(".fchip"); if (!b) return;
  const bi = +b.dataset.b;
  restartIfPlaying(() => { state.pos = Math.max(0, seq.findIndex(r => r.block === bi)); });
  if (!playing) previewCurrent();
});

/* ---------- Bedienelemente ---------- */
const $ = id => document.getElementById(id);
const playIcon = $("playIcon"), bPlay = $("bPlay"), tempo = $("tempo"), modeSel = $("mode");
function updatePlayBtn() {
  playIcon.innerHTML = playing ? '<path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/>' : '<path d="M7 4.5v15l13-7.5z"/>';
  bPlay.setAttribute("aria-label", playing ? "Pause" : "Abspielen");
}
function setBpm(v) {
  state.bpm = Math.max(20, Math.min(120, Math.round(v)));
  tempo.value = state.bpm;
  $("bpmOut").textContent = `♩ = ${state.bpm}`;
  $("pct").textContent = `${Math.round(state.bpm / song.refBpm * 100)} % vom Originaltempo (♩ ≈ ${song.refBpm})`;
  persist();
}
bPlay.addEventListener("click", toggle);
$("bPrev").addEventListener("click", () => step(-1));
$("bNext").addEventListener("click", () => step(1));
$("bStart").addEventListener("click", () => { restartIfPlaying(() => { state.pos = 0; }); });
tempo.addEventListener("input", () => setBpm(+tempo.value));
modeSel.addEventListener("change", () => {
  restartIfPlaying(() => {
    if (modeSel.value === "measure") measureLock = seq[state.pos].m;
    state.mode = modeSel.value; rebuildSeq(); persist();
  });
});
const bindToggle = (id, key, after) => {
  const el = $(id); el.checked = !!state[key];
  el.addEventListener("change", () => { state[key] = el.checked; persist(); if (after) after(); else render(); });
};
bindToggle("tRepeats", "repeats", () => restartIfPlaying(() => { rebuildSeq(); buildTab(); }));
bindToggle("tMetro", "metro", () => {});
bindToggle("tCount", "countIn", () => {});
bindToggle("tNext", "showNext");
bindToggle("tRing", "showRing");
bindToggle("tNames", "names");
document.querySelectorAll(".chip").forEach(ch => {
  const r = ch.dataset.role;
  ch.setAttribute("aria-pressed", String(!state.muted[r]));
  ch.addEventListener("click", () => { state.muted[r] = !state.muted[r]; ch.setAttribute("aria-pressed", String(!state.muted[r])); persist(); render(); });
});
document.addEventListener("keydown", e => {
  const t = e.target, tag = t.tagName;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (tag === "SELECT" || (tag === "INPUT" && t.type === "range" && e.key.startsWith("Arrow"))) return;
  if (e.key === " ") { if (tag === "BUTTON") return; e.preventDefault(); toggle(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setBpm(state.bpm + 2); }
  else if (e.key === "ArrowDown") { e.preventDefault(); setBpm(state.bpm - 2); }
  else if (e.key === "Home") { e.preventDefault(); restartIfPlaying(() => { state.pos = 0; }); }
});

/* ---------- Start ---------- */
function loadSong(s) {
  song = s;
  $("songTitle").textContent = s.title;
  $("songMeta").textContent = s.meta;
  if (!saved.bpm) state.bpm = s.defaultBpm;
  setBpm(state.bpm);
  modeSel.value = state.mode;
  if (state.mode === "measure") measureLock = 0;
  state.pos = 0; seq = buildSeq();
  buildBoard(); buildTab(); render();
}
const songSel = $("songSel");
songSel.innerHTML = SONGS.map(s => `<option value="${s.id}">${s.title}</option>`).join("") + `<option disabled>Weitere Stücke folgen</option>`;
songSel.addEventListener("change", () => { stop(true); loadSong(SONGS.find(s => s.id === songSel.value)); });
updatePlayBtn();
loadSong(SONGS[0]);
})();
