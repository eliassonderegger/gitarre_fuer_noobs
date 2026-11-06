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
const DEFAULTS = { bpm: 56, mode: "all", repeats: true, metro: false, countIn: true, showNext: true, showRing: true, showLane: false, stepSound: false, names: true, muted: { melody:false, harmony:false, bass:false } };
let saved = {};
try { saved = JSON.parse(localStorage.getItem("gtt-settings") || "{}") || {}; } catch (e) { saved = {}; }
if (saved.v !== 2) delete saved.showLane;   // Mitspiel-Leiste ist neu standardmässig aus
const state = Object.assign({}, DEFAULTS, saved, { muted: Object.assign({}, DEFAULTS.muted, saved.muted || {}) });
state.pos = 0;
let song = SONGS[0];
let seq = [], blocks = [], measureLock = 0;
let seqStart = [], seqBar = [], seqTotal = 0, seqBars = 0, seqDirty = true;
function persist() {
  try {
    const { bpm, mode, repeats, metro, countIn, showNext, showRing, showLane, stepSound, names, muted, songId } = state;
    localStorage.setItem("gtt-settings", JSON.stringify({ v: 2, bpm, mode, repeats, metro, countIn, showNext, showRing, showLane, stepSound, names, muted, songId }));
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
    blocks = bl.map(b => { const ms = song.sections[b].measures; return { label: b, sec: b, sub: "T " + (ms[0] + 1) + "–" + (ms[ms.length - 1] + 1) }; });
  }
  // Startzeit jedes Schritts in Achteln (für Spulleiste und Mitspiel-Leiste)
  seqStart = []; seqBar = []; let x = 0, bar = 0;
  s.forEach((r, i) => { seqStart[i] = x; if (r.e === 0) bar++; seqBar[i] = bar; x += song.measures[r.m][r.e].dur; });
  seqTotal = x; seqBars = bar; seqDirty = true;
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
let lastOwnSound = -1e9;   // eigene Töne nicht als Spiel des Nutzers erkennen
function playNote(s, midi, t, gain, legato) {
  lastOwnSound = Math.max(lastOwnSound, performance.now() + (t - ctx.currentTime) * 1000);
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
let playStart = 0, posTime = 0;
const eighth = () => 30 / state.bpm;

function play(withCountIn = state.countIn) {
  if (listen.on) stopListening();
  ensureAudio();
  if (playing) return;
  if (!isLoop() && state.pos >= seq.length - 1) state.pos = 0;
  playing = true; queue = []; endAt = null; nextIdx = state.pos;
  let t = ctx.currentTime + 0.08;
  if (withCountIn) { const q = 2 * eighth(); for (let i = 0; i < song.beats; i++) click(t + i * q, i === 0); t += song.beats * q; }
  else t += 0.1;
  nextTime = t; playStart = t; posTime = t;
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
  while (queue.length && queue[0].t <= now + 0.01) { const q = queue.shift(); state.pos = q.i; posTime = q.t; changed = true; }
  if (changed) render();
  drawFrame();
  if (endAt !== null && now >= endAt + 0.1) { stop(false); return; }
  raf = requestAnimationFrame(tick);
}
function stop(kill = true) {
  playing = false; clearInterval(timer); cancelAnimationFrame(raf); queue = [];
  if (kill) killAll();
  updatePlayBtn();
  drawFrame(); savePos();
}
function toggle() { playing ? stop(true) : play(); }
function restartIfPlaying(fn) { const was = playing; if (was) stop(true); fn(); render(); if (was) play(false); }
function previewCurrent() { if (listen.on || !state.stepSound) return; ensureAudio(); playEvent(evOf(seq[state.pos]), ctx.currentTime + 0.01); }
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
const BOARD_ROLE = { melody: "#b5402b", harmony: "#3d7a58", bass: "#c99a2e" };
const board = document.getElementById("board");

function buildBoard() {
  const end = 1186;
  let h = `<defs>
    <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a281d"/><stop offset=".5" stop-color="#2d1f16"/><stop offset="1" stop-color="#241810"/></linearGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1d15"/><stop offset="1" stop-color="#1b120d"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="0" y="0" width="1200" height="322" fill="url(#frame)"/>
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
  h += `<rect x="${BX0 - 7}" y="32" width="9" height="252" fill="#efe6d6"/>`;
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
  h += `<g id="mkLayer" pointer-events="none"></g><g id="apLayer" pointer-events="none"></g><g id="probeLayer" pointer-events="none"></g>`;
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
  g.innerHTML = `<g transform="translate(${noteX(f)},${sy(s)})"><circle r="16" fill="#f6ede1" stroke="#b5402b" stroke-width="2.5"/><text text-anchor="middle" dy="5" font-size="14" font-weight="700" fill="#2a1d16">${f}</text><text x="19" y="-15" font-size="12.5" font-weight="700" fill="#f6ede1" stroke="#1d140e" stroke-width="3.5" paint-order="stroke">${nameOf(n.midi)}</text></g>`;
  layer.appendChild(g);
  setTimeout(() => g.remove(), 900);
}
// Auf schmalen Bildschirmen das Griffbrett zu den aktuellen Tönen mitscrollen
const boardScroll = document.getElementById("boardScroll");
function followBoard(ev) {
  const sw = boardScroll.scrollWidth, cw = boardScroll.clientWidth;
  if (sw <= cw + 2) return;
  const k = sw / 1200, xs = ev.notes.map(n => noteX(n.f) * k);
  const lo = Math.min(...xs) - 50, hi = Math.max(...xs) + 70, sl = boardScroll.scrollLeft;
  if (lo >= sl && hi <= sl + cw) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const target = hi - lo > cw ? lo : (lo + hi) / 2 - cw / 2;
  boardScroll.scrollTo({ left: clamp(target, 0, sw - cw), behavior: reduce ? "auto" : "smooth" });
}
board.addEventListener("click", e => {
  const r = e.target.closest(".hit"); if (!r) return;
  probe(+r.dataset.s, +r.dataset.f);
});

/* ---------- Tabulatur ---------- */
const tabEl = document.getElementById("tab");
let tabRefs = [], curTab = { m: -1, e: -1 };
const TAB_PX = 36, TAB_PL = 34;
function buildTab() {
  tabEl.innerHTML = ""; tabRefs = []; curPh = null;
  const PX = TAB_PX, PL = TAB_PL, PR = 16, TOP = 30, SP = 13, H = TOP + 5 * SP + 16;
  let out = "";
  song.measures.forEach((meas, mi) => {
    const W = PL + song.eighths * PX + PR;
    const sec = sectionOf(mi), ms = song.sections[sec].measures;
    const isStart = ms[0] === mi, isEnd = ms[ms.length - 1] === mi;
    const rep = state.repeats && song.form.some((b, i) => b === sec && song.form[i + 1] === sec);   // nur echte Wiederholungen
    const xEnd = W - PR + 6, yA = TOP, yB = TOP + 5 * SP;
    let s = `<svg class="meas" data-m="${mi}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="Takt ${mi + 1}">`;
    s += `<rect class="mframe" x="1" y="1" width="${W - 2}" height="${H - 2}"/>`;
    meas.forEach((ev, ei) => {
      const w = PX * Math.min(ev.dur, 1); ev._x = PL + ev.pos * PX + w / 2;
      s += `<rect class="col" data-e="${ei}" x="${ev._x - w / 2}" y="${TOP - 13}" width="${w}" height="${5 * SP + 26}"/>`;
    });
    for (let i = 0; i < 6; i++) {
      const y = TOP + i * SP;
      s += `<line class="sl" x1="${PL - 8}" x2="${xEnd}" y1="${y}" y2="${y}"/><text class="slab" x="8" y="${y + 3}">${"eBGDAE"[i]}</text>`;
    }
    s += `<line class="bar" x1="${PL - 8}" x2="${PL - 8}" y1="${yA}" y2="${yB}"/>`;
    s += `<line class="bar" x1="${xEnd}" x2="${xEnd}" y1="${yA}" y2="${yB}"/>`;
    if (rep && isStart) {
      s += `<line class="rep" x1="${PL - 8}" x2="${PL - 8}" y1="${yA}" y2="${yB}"/><circle class="dot" cx="${PL - 1}" cy="${TOP + 2 * SP - 6.5 + 6.5}" r="2"/><circle class="dot" cx="${PL - 1}" cy="${TOP + 3 * SP}" r="2"/>`;
    }
    if (rep && isEnd) {
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
    s += `<line class="ph" x1="0" x2="0" y1="${TOP - 10}" y2="${yB + 10}" visibility="hidden"/>`;
    s += `</svg>`;
    out += s;
  });
  tabEl.innerHTML = out;
  tabEl.querySelectorAll("svg.meas").forEach(svg => { tabRefs[+svg.dataset.m] = { svg, cols: [...svg.querySelectorAll(".col")], ph: svg.querySelector(".ph") }; });
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
  followBoard(ev);
  const beat = Math.floor(ev.pos / 2) + 1, off = ev.pos % 2;
  const beatTxt = off === 0 ? `Schlag ${beat}` : (off === 1 ? `Schlag ${beat} und` : `Schlag ${beat}, ${Math.abs(off - 2 / 3) < 1e-3 ? "2. Triolenton" : Math.abs(off - 4 / 3) < 1e-3 ? "3. Triolenton" : "Zwischenton"}`);
  posLabel.innerHTML = `Teil ${sectionOf(ref.m)} · Takt ${ref.m + 1} · ${beatTxt}<small>Schritt ${ref.e + 1} von ${song.measures[ref.m].length}</small>`;
  nowNotes.innerHTML = ev.notes.map(n => `<span class="nchip ${n.role}"><b>${nameOf(n.midi)}</b> Saite ${n.s} · Bund ${n.f}${n.tech ? ` <em>${TECH_DE[n.tech]}</em>` : ""}</span>`).join("");
  formChips.innerHTML = blocks.map((b, i) => `<button class="fchip${i === ref.block ? " cur" : (i < ref.block ? " done" : "")}" data-b="${i}" aria-label="Zu ${b.label} springen"><b>${b.label}</b><span>${b.sub}</span></button>`).join("");
  highlightTab(ref);
  if (seqDirty) { buildSeek(); seqDirty = false; }
  if (!playing) { drawFrame(); savePos(); }
  if (listen.on) listenTarget();
}
function savePos() {
  const r = seq[state.pos]; if (!r) return;
  try { localStorage.setItem("gtt-pos-" + song.id, JSON.stringify({ m: r.m, e: r.e, block: r.block, mode: state.mode })); } catch (e) {}
}
function restorePos() {
  try {
    const p = JSON.parse(localStorage.getItem("gtt-pos-" + song.id) || "null");
    if (!p || p.mode !== state.mode) return;
    const i = seq.findIndex(r => r.m === p.m && r.e === p.e && r.block === p.block);
    if (i >= 0) state.pos = i;
  } catch (e) {}
}

/* ---------- Zeitachse: Mitspiel-Leiste, Spulleiste, Schläge ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = sec => { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };
// aktuelle Position in Achteln (fliessend während der Wiedergabe, negativ beim Einzählen)
let laneView = null;   // freie Position beim Ziehen/Scrollen in der Mitspiel-Leiste
function curX() {
  if (laneView !== null) return laneView;
  const base = seqStart[state.pos];
  if (!playing || !ctx) return base;
  const now = ctx.currentTime;
  if (now < playStart) return base - (playStart - now) / eighth();
  return base + clamp((now - posTime) / eighth(), 0, evOf(seq[state.pos]).dur);
}
function drawFrame() {
  if (!seq.length) return;
  const cx = curX();
  drawLane(cx); drawApproach(cx); updateBeats(cx); updatePlayhead(cx); updateSeek(cx);
}

// Mitspiel-Leiste (Canvas)
const lane = $id("lane"), laneWrap = $id("laneWrap"), lctx = lane.getContext("2d");
let laneW = 0, laneH = 0;
function $id(id) { return document.getElementById(id); }
function sizeLane() {
  const r = lane.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  laneW = r.width; laneH = r.height;
  lane.width = Math.round(r.width * dpr); lane.height = Math.round(r.height * dpr);
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
// Schritte rund um die aktuelle Position, bei Schleifen über das Ende hinaus fortgesetzt
function eachVisible(cx, from, to, fn) {
  const n = seq.length;
  for (let k = state.pos - 12; k < state.pos + 80; k++) {
    let idx = k, off = 0;
    if (k < 0 || k >= n) { if (!isLoop()) continue; idx = ((k % n) + n) % n; off = Math.floor(k / n) * seqTotal; }
    const start = seqStart[idx] + off, ev = evOf(seq[idx]);
    if (start + ev.dur < from) continue;
    if (start > to) break;
    fn(ev, start, idx);
  }
}
function drawLane(cx) {
  if (!state.showLane || !laneW) return;
  const g = lctx, W = laneW, H = laneH;
  const top = 14, rowH = (H - top - 12) / 6, y = s => top + (s - 0.5) * rowH;
  const PXE = W < 600 ? 42 : 50, hitX = W < 600 ? 72 : 100, gutter = 30;
  // Radius so wählen, dass sich auch schnelle Töne (Sechzehntel) nicht überlappen
  const rad = Math.min(11, rowH * 0.46, (0.5 * PXE - 3) / 2);
  g.clearRect(0, 0, W, H);
  g.fillStyle = "#241810"; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(0,0,0,.22)"; g.fillRect(gutter, 0, hitX - gutter, H);
  const from = cx - (hitX - gutter) / PXE, to = cx + (W - hitX) / PXE;
  // Schlag- und Taktlinien
  const E = song.eighths;
  for (let e = Math.ceil(from); e <= to; e++) {
    if (e % 2 !== 0) continue;
    const x = hitX + (e - cx) * PXE, bar = ((e % E) + E) % E === 0;
    g.strokeStyle = bar ? "rgba(233,223,209,.38)" : "rgba(233,223,209,.10)";
    g.lineWidth = bar ? 1.5 : 1;
    g.beginPath(); g.moveTo(x, 6); g.lineTo(x, H - 6); g.stroke();
  }
  // Saiten
  const sc = ["#ece4d8", "#e4dacb", "#dbd0bf", "#c9a35d", "#c39a52", "#b98f47"];
  g.font = "700 11px 'Jost', system-ui, sans-serif"; g.textBaseline = "middle"; g.textAlign = "center";
  for (let s = 1; s <= 6; s++) {
    g.strokeStyle = sc[s - 1]; g.globalAlpha = .45; g.lineWidth = 0.8 + s * 0.25;
    g.beginPath(); g.moveTo(gutter, y(s)); g.lineTo(W, y(s)); g.stroke();
    g.globalAlpha = 1; g.fillStyle = "#bfb2a2"; g.fillText("eBGDAE"[s - 1], 14, y(s));
  }
  // sichtbare Töne sammeln
  const items = []; let flash = 0;
  eachVisible(cx, from - 1, to + 1, (ev, start) => {
    const d = start - cx; if (d > -0.35 && d < 0.35) flash = Math.max(flash, 1 - Math.abs(d) / 0.35);
    items.push({ ev, start, x: hitX + d * PXE, past: start + ev.dur <= cx, act: start <= cx && cx < start + ev.dur });
  });
  const counting = playing && cx < seqStart[state.pos];
  // Einzähl-Abdunkelung und Spiellinie liegen HINTER den Tönen, damit keine Zahl verdeckt wird
  if (counting) { g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(gutter, 0, hitX - gutter, H); }
  g.strokeStyle = "rgba(246,237,225,.85)"; g.lineWidth = 2 + flash * 2;
  g.shadowColor = "#d9a441"; g.shadowBlur = 4 + flash * 16;
  g.beginPath(); g.moveTo(hitX, 4); g.lineTo(hitX, H - 4); g.stroke();
  g.shadowBlur = 0;
  // Töne (nicht über die Saitenbeschriftung zeichnen)
  g.save(); g.beginPath(); g.rect(gutter, 0, W - gutter, H); g.clip();
  const alphaOf = (it, n) => (it.past ? 0.28 : 1) * (state.muted[n.role] ? 0.35 : 1);
  // 1) alle Haltebalken zuerst, damit sie nie über einer Zahl liegen
  items.forEach(it => it.ev.notes.forEach(n => {
    const tail = it.ev.dur * PXE - rad - 4; if (tail <= 0) return;
    g.globalAlpha = alphaOf(it, n) * 0.45; g.fillStyle = BOARD_ROLE[n.role];
    g.fillRect(it.x, y(n.s) - 3, tail + rad, 6);
  }));
  // 2) Köpfe von spät nach früh: der Ton, der als Nächstes dran ist, liegt immer oben
  const order = items.slice().reverse();
  order.sort((a, b) => (a.act === b.act ? 0 : a.act ? 1 : -1));
  g.font = "700 11px 'Jost', system-ui, sans-serif"; g.textBaseline = "middle"; g.textAlign = "center";
  order.forEach(it => it.ev.notes.forEach(n => {
    const yy = y(n.s), r = it.act ? rad + 1.5 : rad;
    g.globalAlpha = alphaOf(it, n);
    g.beginPath(); g.arc(it.x, yy, r, 0, Math.PI * 2);
    g.fillStyle = BOARD_ROLE[n.role]; g.fill();
    g.lineWidth = it.act ? 2.2 : 1.5; g.strokeStyle = it.act ? "#fbf6ee" : "#241810"; g.stroke();
    g.fillStyle = "#fff"; g.fillText(String(n.f), it.x, yy + 0.5);
    if (n.tech) { g.fillStyle = "#e9dfd1"; g.font = "italic 600 10px 'Jost', system-ui"; g.fillText(n.tech, it.x - r - 5, yy - r + 1); g.font = "700 11px 'Jost', system-ui, sans-serif"; }
  }));
  g.globalAlpha = 1;
  g.restore();
  if (!playing && laneView === null) {
    g.fillStyle = "rgba(233,223,209,.45)"; g.font = "600 11px 'Jost', system-ui, sans-serif"; g.textAlign = "right";
    g.fillText("← ziehen zum Spulen →", W - 10, 8); g.textAlign = "center";
  }
  // Einzähl-Zahl links neben der Spiellinie, ohne die Töne zu berühren
  if (counting) {
    const left = Math.ceil((seqStart[state.pos] - cx) / 2 - 1e-6);
    g.fillStyle = "#f6ede1"; g.font = "600 34px 'Jost', system-ui, sans-serif";
    g.fillText(String(left), (gutter + hitX - rad) / 2, H / 2);
  }
}

// Ringe auf dem Griffbrett, die sich bis zum Anschlag zusammenziehen
function drawApproach(cx) {
  const layer = $id("apLayer"); if (!layer) return;
  if (!playing) { layer.innerHTML = ""; return; }
  let h = "";
  eachVisible(cx, cx + 0.001, cx + 2, (ev, start) => {
    if (start <= cx) return;
    const p = clamp((start - cx) / 2, 0, 1);
    ev.notes.forEach(n => {
      if (state.muted[n.role]) return;
      h += `<circle cx="${noteX(n.f)}" cy="${sy(n.s)}" r="${(16 + 26 * p).toFixed(1)}" fill="none" stroke="${BOARD_ROLE[n.role]}" stroke-width="${(3.5 - p * 1.5).toFixed(2)}" opacity="${(1 - p * 0.75).toFixed(2)}"/>`;
    });
  });
  layer.innerHTML = h;
}

// Schlaganzeige
const beatsEl = $id("beats"); let beatsKey = "";
function updateBeats(cx) {
  const ci = playing && cx < seqStart[state.pos];
  let b;
  if (ci) b = song.beats - Math.ceil((seqStart[state.pos] - cx) / 2 - 1e-6);
  else { const m0 = seqStart[state.pos] - evOf(seq[state.pos]).pos; b = Math.floor((cx - m0) / 2 + 1e-6); }
  const key = song.beats + "|" + b + "|" + ci + "|" + playing;
  if (key === beatsKey) return; beatsKey = key;
  let h = "";
  for (let i = 0; i < song.beats; i++) h += `<i class="${i === b ? "on" : ""}${i === 0 ? " one" : ""}"></i>`;
  h += `<span>${ci ? "Einzählen" : "Schlag " + (b + 1) + " von " + song.beats}</span>`;
  beatsEl.innerHTML = h;
  beatsEl.classList.toggle("ci", ci);
}

// mitlaufender Strich in der Tabulatur
let curPh = null;
function updatePlayhead(cx) {
  if (curPh) curPh.setAttribute("visibility", "hidden");
  curPh = null;
  if (!playing || cx < seqStart[state.pos]) return;
  const ref = seq[state.pos], t = tabRefs[ref.m]; if (!t) return;
  const xin = clamp(evOf(ref).pos + (cx - seqStart[state.pos]), 0, song.eighths);
  const x = TAB_PL + xin * TAB_PX;
  t.ph.setAttribute("x1", x); t.ph.setAttribute("x2", x); t.ph.setAttribute("visibility", "visible");
  curPh = t.ph;
}

// Spulleiste
const seek = $id("seek"), seekTrack = $id("seekTrack"), seekFill = $id("seekFill"), seekThumb = $id("seekThumb"), seekBubble = $id("seekBubble");
function buildSeek() {
  let h = "";
  blocks.forEach((b, bi) => {
    const first = seq.findIndex(r => r.block === bi);
    const nextFirst = seq.findIndex(r => r.block === bi + 1);
    const a = seqStart[first], e = nextFirst < 0 ? seqTotal : seqStart[nextFirst];
    const cls = b.sec === "B" ? "b" : "a";
    h += `<div class="sseg ${cls}" style="left:${a / seqTotal * 100}%;width:${(e - a) / seqTotal * 100}%"><span>${b.label}</span></div>`;
  });
  seq.forEach((r, i) => { if (i > 0 && r.e === 0) h += `<i class="stick" style="left:${seqStart[i] / seqTotal * 100}%"></i>`; });
  seekTrack.innerHTML = h;
  seek.setAttribute("aria-valuemax", String(seqBars));
}
function updateSeek(cx) {
  const f = clamp(cx / seqTotal, 0, 1) * 100;
  seekFill.style.width = f + "%"; seekThumb.style.left = f + "%";
  $id("tNow").textContent = fmtTime(Math.max(0, cx) * eighth());
  $id("tTotal").textContent = fmtTime(seqTotal * eighth());
  const ref = seq[state.pos];
  $id("mNow").textContent = `Takt ${seqBar[state.pos]} von ${seqBars} · Teil ${sectionOf(ref.m)}`;
  seek.setAttribute("aria-valuenow", String(seqBar[state.pos]));
  seek.setAttribute("aria-valuetext", `Takt ${seqBar[state.pos]} von ${seqBars}`);
}
function idxAtClient(clientX) {
  const r = seek.getBoundingClientRect();
  const x = clamp((clientX - r.left) / r.width, 0, 1) * seqTotal;
  let i = 0; while (i + 1 < seq.length && seqStart[i + 1] <= x + 1e-9) i++;
  return { i, frac: clamp((clientX - r.left) / r.width, 0, 1) };
}
function showBubble(clientX) {
  const { i, frac } = idxAtClient(clientX), ref = seq[i];
  seekBubble.hidden = false;
  seekBubble.style.left = (frac * 100) + "%";
  seekBubble.textContent = `Takt ${ref.m + 1} · Teil ${sectionOf(ref.m)} · ${fmtTime(seqStart[i] * eighth())}`;
}
let seekDrag = null;
seek.addEventListener("pointerdown", e => {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault(); seek.focus({ preventScroll: true });
  try { seek.setPointerCapture(e.pointerId); } catch (err) {}
  seekDrag = { was: playing }; if (playing) stop(true);
  const { i } = idxAtClient(e.clientX); state.pos = i; render(); showBubble(e.clientX);
});
seek.addEventListener("pointermove", e => {
  showBubble(e.clientX);
  if (!seekDrag) return;
  const { i } = idxAtClient(e.clientX);
  if (i !== state.pos) { state.pos = i; render(); }
});
const endDrag = () => {
  if (!seekDrag) return;
  const was = seekDrag.was; seekDrag = null;
  if (was) play(false); else previewCurrent();
};
seek.addEventListener("pointerup", e => { endDrag(); if (e.pointerType !== "mouse") seekBubble.hidden = true; });
seek.addEventListener("pointercancel", () => { seekDrag = null; seekBubble.hidden = true; });
seek.addEventListener("pointerleave", () => { if (!seekDrag) seekBubble.hidden = true; });
function jumpBar(d) {
  restartIfPlaying(() => {
    const n = seq.length;
    if (d > 0) { let i = state.pos + 1; while (i < n && seq[i].e !== 0) i++; state.pos = i < n ? i : (isLoop() ? 0 : state.pos); }
    else {
      let i = state.pos; while (i > 0 && seq[i].e !== 0) i--;
      if (i === state.pos && i > 0) { i--; while (i > 0 && seq[i].e !== 0) i--; }
      state.pos = i;
    }
  });
  if (!playing) previewCurrent();
}
window.addEventListener("resize", () => { sizeLane(); drawFrame(); });

// Mitspiel-Leiste seitlich ziehen oder scrollen, um zu einer Stelle zu springen
const lanePXE = () => (laneW < 600 ? 42 : 50), laneHitX = () => (laneW < 600 ? 72 : 100);
function idxContaining(x) { let i = 0; while (i + 1 < seq.length && seqStart[i + 1] <= x + 1e-9) i++; return i; }
function idxNearest(x) { const i = idxContaining(x); return (i + 1 < seq.length && seqStart[i + 1] - x < x - seqStart[i]) ? i + 1 : i; }
function laneMoveTo(v) {
  laneView = clamp(v, 0, seqTotal - 0.01);
  const i = idxContaining(laneView);
  if (i !== state.pos) { state.pos = i; render(); } else drawFrame();
}
function laneSettle(resume) {
  if (laneView === null) return;
  state.pos = idxNearest(laneView); laneView = null; render();
  if (resume) play(false); else previewCurrent();
}
let laneDrag = null, wheelTimer = 0, wheelWas = false;
lane.addEventListener("pointerdown", e => {
  if (e.button !== undefined && e.button !== 0) return;
  try { lane.setPointerCapture(e.pointerId); } catch (err) {}
  laneDrag = { x0: e.clientX, v0: curX(), was: playing, moved: false };
  if (playing) stop(true);
  lane.classList.add("dragging");
});
lane.addEventListener("pointermove", e => {
  if (!laneDrag) return;
  const dx = e.clientX - laneDrag.x0;
  if (!laneDrag.moved && Math.abs(dx) < 4) return;
  laneDrag.moved = true;
  laneMoveTo(laneDrag.v0 - dx / lanePXE());
});
const laneUp = e => {
  if (!laneDrag) return;
  const d = laneDrag; laneDrag = null; lane.classList.remove("dragging");
  if (!d.moved && e && e.type === "pointerup") {   // Tippen: zum angetippten Zeitpunkt springen
    const r = lane.getBoundingClientRect();
    laneView = clamp(d.v0 + (e.clientX - r.left - laneHitX()) / lanePXE(), 0, seqTotal - 0.01);
  }
  laneSettle(d.was);
};
lane.addEventListener("pointerup", laneUp);
lane.addEventListener("pointercancel", () => { if (laneDrag) { laneDrag = null; lane.classList.remove("dragging"); laneSettle(false); } });
lane.addEventListener("wheel", e => {
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
  if (!d) return;   // senkrechtes Scrollen bleibt für die Seite
  e.preventDefault();
  if (playing) { wheelWas = true; stop(true); }
  laneMoveTo(curX() + d / lanePXE());
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { const w = wheelWas; wheelWas = false; laneSettle(w); }, 260);
}, { passive: false });

/* ---------- Mithören: Mikrofon, Tonerkennung (YIN), warten bis richtig gespielt ---------- */
const listen = { on: false, stream: null, src: null, an: null, buf: null, raf: 0, floor: 0.003, trough: 1, lastOnset: 0, onsetT: -1e9, hits: 0, stepT: 0, streak: 0, cmnd: null };
const lBar = $id("listenBar"), lMsg = $id("lMsg"), tListen = $id("tListen"), lSens = $id("lSens");
const freqToMidi = f => 69 + 12 * Math.log2(f / 440);
function lMessage(t) { lMsg.textContent = t || ""; lMsg.hidden = !t; }

async function startListening() {
  lMessage("");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { lBar.hidden = false; lMessage("Dieser Browser erlaubt hier keinen Mikrofonzugriff. Öffne die Seite über https in Chrome, Safari oder Firefox."); return false; }
  if (playing) stop(true);
  ensureAudio();
  try {
    listen.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    lBar.hidden = false; lMessage("Kein Zugriff aufs Mikrofon. Erlaube den Zugriff im Browser (Schloss-Symbol neben der Adresse) und schalte Mithören erneut ein.");
    return false;
  }
  listen.src = ctx.createMediaStreamSource(listen.stream);
  listen.an = ctx.createAnalyser(); listen.an.fftSize = 2048;
  listen.src.connect(listen.an);
  listen.buf = new Float32Array(listen.an.fftSize);
  listen.cmnd = new Float32Array(listen.an.fftSize);
  listen.on = true; listen.streak = 0;
  lBar.hidden = false; lBar.classList.add("live");
  $id("lStatus").textContent = "Hört zu. Spiel den angezeigten Ton.";
  listenTarget();
  listen.raf = requestAnimationFrame(listenLoop);
  return true;
}
function stopListening() {
  listen.on = false; cancelAnimationFrame(listen.raf);
  if (listen.stream) listen.stream.getTracks().forEach(t => t.stop());
  try { listen.src && listen.src.disconnect(); } catch (e) {}
  listen.stream = listen.src = listen.an = null;
  tListen.checked = false;
  lBar.hidden = true; lBar.classList.remove("live", "hit", "miss");
}
tListen.addEventListener("change", async () => {
  if (tListen.checked) { const ok = await startListening(); if (!ok) tListen.checked = false; }
  else { stopListening(); lMessage(""); }
});
$id("lSkip").addEventListener("click", () => listenAdvance(false));

// Zielton(e) des aktuellen Schritts anzeigen
function listenTarget() {
  const ev = evOf(seq[state.pos]);
  const main = ev.notes.find(n => n.role === "melody") || ev.notes[0];
  $id("lTarget").textContent = ev.notes.map(n => nameOf(n.midi)).join(" · ");
  $id("lTargetSub").textContent = ev.notes.length > 1
    ? `Einer davon reicht · z. B. Saite ${main.s}, Bund ${main.f}`
    : `Saite ${main.s} · Bund ${main.f}`;
  $id("lStreak").textContent = listen.streak ? `${listen.streak} richtig in Folge` : "";
  // kurze Sperrzeit: der gerade gespielte Ton soll nicht schon für den nächsten Schritt zählen
  listen.stepT = performance.now() + 250; listen.hits = 0; listen.onsetT = -1e9;
  if (lBar.classList.contains("miss")) { lBar.classList.remove("miss"); $id("lStatus").textContent = "Hört zu. Spiel den angezeigten Ton."; }
}
function listenAdvance(correct) {
  if (correct) listen.streak++; else listen.streak = 0;
  lBar.classList.remove("miss"); lBar.classList.toggle("hit", correct);
  setTimeout(() => lBar.classList.remove("hit"), 280);
  if (state.pos >= seq.length - 1 && !isLoop()) {
    $id("lStatus").textContent = "Geschafft! Du hast das Stück bis zum Ende gespielt.";
    listen.stepT = Infinity; return;
  }
  state.pos = (state.pos + 1) % seq.length;
  render();
}

// Grundfrequenz nach YIN (de Cheveigné & Kawahara)
function detectPitch(x, sr, cmnd) {
  const N = x.length, tMin = Math.floor(sr / 1400), tMax = Math.min(Math.floor(sr / 72), N >> 1), W = N - tMax;
  let sum = 0; cmnd[0] = 1;
  for (let t = 1; t <= tMax; t++) {
    let d = 0;
    for (let i = 0; i < W; i++) { const v = x[i] - x[i + t]; d += v * v; }
    sum += d; cmnd[t] = sum ? d * t / sum : 1;
  }
  let t = -1;
  for (let k = tMin; k < tMax; k++) {
    if (cmnd[k] < 0.15) { while (k + 1 < tMax && cmnd[k + 1] < cmnd[k]) k++; t = k; break; }
  }
  if (t < 0) { let best = 1; for (let k = tMin; k < tMax; k++) if (cmnd[k] < best) { best = cmnd[k]; t = k; } if (best > 0.3) return null; }
  const a = cmnd[t - 1] ?? cmnd[t], b = cmnd[t], c = cmnd[t + 1] ?? cmnd[t];
  const den = a - 2 * b + c, shift = den ? 0.5 * (a - c) / den : 0;
  return { f: sr / (t + clamp(shift, -1, 1)), conf: 1 - b };
}
// passt der gehörte Ton zu einem Ton des Schritts? (eine Oktave Abweichung wird toleriert)
function matchTarget(m, ev) {
  for (const n of ev.notes) {
    const diff = m - n.midi;
    if (Math.abs(diff) > 12.5) continue;
    const pc = ((diff % 12) + 12) % 12, d = Math.min(pc, 12 - pc);
    if (d < 0.45) return n;
  }
  return null;
}
function listenLoop() {
  if (!listen.on || !listen.an) return;
  const x = listen.buf; listen.an.getFloatTimeDomainData(x);
  let sq = 0; for (let i = 0; i < x.length; i++) sq += x[i] * x[i];
  const rms = Math.sqrt(sq / x.length), now = performance.now();
  // Grundrauschen langsam mitführen, Schwelle aus Empfindlichkeit
  listen.floor = rms < listen.floor ? listen.floor * 0.9 + rms * 0.1 : listen.floor * 0.9995 + rms * 0.0005;
  const sens = +lSens.value, thr = Math.max(listen.floor * (1.6 + (10 - sens) * 0.45), 0.0025 + (10 - sens) * 0.0022);
  // Anschlag erkennen: deutlicher Anstieg gegenüber dem Tiefpunkt seit dem letzten Anschlag
  listen.trough = Math.min(listen.trough, rms);
  const ownSound = now < lastOwnSound + 700;
  if (!ownSound && rms > thr && rms > listen.trough * 1.8 && now - listen.lastOnset > 110) {
    listen.lastOnset = now; listen.trough = rms;
    if (now >= listen.stepT) { listen.onsetT = now; listen.hits = 0; }
  }
  // Pegelanzeige
  $id("lLevel").style.width = clamp(Math.sqrt(rms / 0.25), 0, 1) * 100 + "%";
  $id("lThr").style.left = clamp(Math.sqrt(thr / 0.25), 0, 1) * 100 + "%";
  // Tonhöhe
  if (rms > thr * 0.7) {
    const p = detectPitch(x, ctx.sampleRate, listen.cmnd);
    if (p && p.conf > 0.75) {
      const m = freqToMidi(p.f), r = Math.round(m), cents = Math.round((m - r) * 100);
      $id("lHeard").textContent = nameOf(r);
      $id("lCents").textContent = (cents === 0 ? "genau" : (cents > 0 ? "+" : "") + cents + " Cent") + " · " + p.f.toFixed(1) + " Hz";
      const ev = evOf(seq[state.pos]);
      if (now - listen.onsetT < 450 && !ownSound) {
        if (matchTarget(m, ev)) { if (++listen.hits >= 3) { listen.onsetT = -1e9; listenAdvance(true); } }
        else if (now - listen.onsetT > 250 && listen.hits === 0) {
          lBar.classList.add("miss"); $id("lStatus").textContent = `Gehört ${nameOf(r)}, gesucht ${ev.notes.map(n => nameOf(n.midi)).join(" oder ")}`;
          listen.onsetT = -1e9; listen.streak = 0; $id("lStreak").textContent = "";
        }
      }
    }
  } else if (now - listen.lastOnset > 1500) {
    $id("lHeard").textContent = "–"; $id("lCents").textContent = "";
    if (lBar.classList.contains("miss")) { lBar.classList.remove("miss"); $id("lStatus").textContent = "Hört zu. Spiel den angezeigten Ton."; }
  }
  listen.raf = requestAnimationFrame(listenLoop);
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
  if (!playing) drawFrame();
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
bindToggle("tLane", "showLane", () => { laneWrap.hidden = !state.showLane; sizeLane(); drawFrame(); });
bindToggle("tNext", "showNext");
bindToggle("tRing", "showRing");
bindToggle("tNames", "names");
bindToggle("tStepSound", "stepSound", () => {});
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
  else if (e.key === "PageDown") { e.preventDefault(); jumpBar(1); }
  else if (e.key === "PageUp") { e.preventDefault(); jumpBar(-1); }
  else if (e.key === "Home") { e.preventDefault(); restartIfPlaying(() => { state.pos = 0; }); }
});

/* ---------- Start ---------- */
function loadSong(s, initial) {
  song = s; state.songId = s.id;
  $("songTitle").textContent = s.title;
  $("songMeta").textContent = s.meta;
  if (!initial || !saved.bpm) state.bpm = s.defaultBpm;
  setBpm(state.bpm);
  modeSel.value = state.mode;
  if (state.mode === "measure") {
    measureLock = 0;
    try { const p = JSON.parse(localStorage.getItem("gtt-pos-" + s.id) || "null"); if (p && p.mode === "measure") measureLock = p.m; } catch (e) {}
  }
  state.pos = 0; seq = buildSeq(); restorePos();
  laneWrap.hidden = !state.showLane;
  buildBoard(); buildTab(); sizeLane(); render();
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => drawFrame());
const songSel = $("songSel");
songSel.innerHTML = SONGS.map(s => `<option value="${s.id}">${s.title}</option>`).join("");
songSel.addEventListener("change", () => { stop(true); if (listen.on) stopListening(); loadSong(SONGS.find(s => s.id === songSel.value)); persist(); });
updatePlayBtn();
const firstSong = SONGS.find(x => x.id === saved.songId) || SONGS[0];
songSel.value = firstSong.id;
loadSong(firstSong, true);
})();
