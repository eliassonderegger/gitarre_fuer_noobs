/* Songdaten für den Gitarren-Tab-Trainer.
   Neues Stück hinzufügen: Takte als [Dauer in Achteln, "Saite:Bund+Stimme[~Technik] ..."] notieren
   und ein Objekt an window.SONGS anhängen.
   Stimme: m = Melodie, h = Harmonie, b = Bass · Technik: ~s Slide, ~h Hammer-on, ~p Pull-off */
(() => {
"use strict";
const TUNING = [64, 59, 55, 50, 45, 40];
const ROLE = { m: "melody", h: "harmony", b: "bass" };
// Takt-Notation: [Dauer in Achteln, "Saite:Bund+Stimme[~Technik] ..."]
function M(raw) {
  let pos = 0;
  return raw.map(([dur, str]) => {
    const notes = str.trim().split(/\s+/).map(tok => {
      const t = tok.match(/^([1-6]):(\d+)([mhb])(?:~([shp]))?$/);
      if (!t) throw new Error("Ungültig: " + tok);
      const s = +t[1], f = +t[2];
      return { s, f, midi: TUNING[s - 1] + f, role: ROLE[t[3]], tech: t[4] || null };
    }).sort((a, b) => a.s - b.s);
    const ev = { dur, pos, notes };
    pos = Math.round((pos + dur) * 1e6) / 1e6;   // Triolen (2/3) ohne Rundungsfehler
    return ev;
  });
}

/* ---------- Lágrima (Francisco Tárrega, 1891) ---------- */
const A1 = [[1,"1:4m 4:2b"],[1,"2:0h"],[1,"1:5m 4:4b"],[1,"2:0h"],[1,"1:7m 4:6b"],[1,"2:0h"]];
const A2 = [[1,"1:2m 4:1b"],[1,"2:0h"],[1,"3:2h"],[1,"2:0h"],[1,"3:2h 5:2b"],[1,"2:0h"]];
const A5 = [[1,"1:12m 4:11b"],[1,"3:9h"],[1,"1:11m 4:9b"],[1,"3:9h"],[1,"1:9m 4:7b"],[1,"2:7h"]];
const A6 = [[1,"1:7m 4:9b"],[1,"2:9h"],[1,"4:11h"],[1,"1:0h"],[1,"3:11h"],[1,"2:10m"]];
const A7 = [[1,"2:9m 4:9b"],[1,"1:0h"],[1,"2:2h 3:3h"],[1,"1:2m"],[1,"5:2b"],[1,"2:4h 3:2h"]];
const A8 = [[2,"1:0m 3:1h 4:2h"],[4,"6:0b"]];
const B1 = [[2,"1:3m 2:0h 6:0b"],[0.5,"1:8m~s"],[0.5,"1:7m~p"],[1,"1:0m"],[1,"1:2m 2:4h 3:2h 5:2b"],[1,"1:3m"]];
const B2 = [[1,"1:0m 6:0b"],[1,"3:5h 4:7h"],[1,"3:4h 4:5h"],[1,"3:2h 4:4h"],[1,"3:0h 4:2h"],[1,"3:2h 4:4h"]];
const B3 = [[1,"2:0h 3:0h 6:0b"],[1,"1:12m"],[1,"4:7h"],[1,"1:8m"],[1,"5:9h"],[1,"2:10m"]];
const B4 = [[1,"2:7m 3:8h 6:7b"],[1,"4:9h"],[1,"4:10h~h"],[1,"4:9h~p"],[1,"2:0h"],[1,"1:2m"]];
const B5 = [[1,"1:3m 4:2b"],[1,"2:0h"],[1,"1:5m 4:4b"],[1,"2:0h"],[1,"1:7m 4:5b"],[1,"2:0h"]];
const B6 = [[1,"1:10m 3:9h 5:0b"],[1,"1:8m~p"],[1,"1:7m"],[1,"2:10m"],[1,"2:8m"],[1,"2:7m"]];
const B7 = [[1,"1:0m 6:3b"],[1,"2:0h 3:0h"],[1,"1:2m 5:0b"],[1,"2:1h 3:2h"],[1,"2:0h 5:2b"],[1,"3:2h 4:1h"]];
const B8 = [[2,"1:0m 3:0h 4:2h"],[4,"6:0b"]];

window.SONGS = (window.SONGS || []).concat([{
  id: "lagrima",
  title: "Lágrima",
  meta: "Francisco Tárrega, 1891 · Preludio im 3/4-Takt · Teil A in E-Dur, Teil B in e-Moll · Ablauf A A B B A",
  beats: 3, eighths: 6, refBpm: 66, defaultBpm: 56,
  sections: {
    A: { key: "E-Dur",  measures: [0,1,2,3,4,5,6,7] },
    B: { key: "e-Moll", measures: [8,9,10,11,12,13,14,15] }
  },
  form: ["A","A","B","B","A"],
  formShort: ["A","B","A"],
  measures: [A1,A2,A1,A2,A5,A6,A7,A8,B1,B2,B3,B4,B5,B6,B7,B8].map(M)
}]);

/* ---------- Romanza (Spanische Romanze, anonym, 19. Jh.) – Teil 1 in e-Moll ----------
   Durchgehende Achteltriolen: Melodie auf der hohen E-Saite, dann leere B- und G-Saite. */
const T = 2 / 3;
// ein Takt aus drei Triolen: Melodiebünde, Saite-2/3-Griff, Bass auf Schlag 1
function R(mel, b2, g3, bass) {
  const out = [];
  mel.forEach((f, i) => {
    out.push([T, `1:${f}m` + (i === 0 && bass ? ` ${bass}b` : "")]);
    out.push([T, `2:${b2}h`]);
    out.push([T, `3:${g3}h`]);
  });
  return out;
}
const RZ = [
  R([7, 7, 7],   0, 0, "6:0"),   // H H H
  R([7, 5, 3],   0, 0, "6:0"),   // H A G
  R([3, 2, 0],   0, 0, "6:0"),   // G Fis E
  R([0, 3, 7],   0, 0, "6:0"),   // E G H
  R([12, 12, 12],0, 0, "6:0"),   // E E E (hoch)
  R([12, 10, 8], 0, 0, "6:0"),   // E D C
  R([8, 7, 5],   5, 5, "5:0"),   // C H A   (a-Moll, Mini-Barré im 5. Bund)
  R([5, 7, 8],   5, 5, "5:0"),   // A H C
  R([7, 8, 7],   7, 8, "6:7"),   // H C H   (H7, 7. Lage)
  R([11, 8, 7],  7, 8, "6:7"),   // Dis C H
  R([7, 5, 3],   0, 0, "6:0"),   // H A G
  R([3, 2, 0],   0, 0, "6:0"),   // G Fis E
  R([2, 2, 2],   0, 2, "5:2"),   // Fis Fis Fis (H7)
  R([2, 3, 2],   0, 2, "5:2"),   // Fis G Fis
  R([0, 0, 0],   0, 0, "6:0"),   // E E E
  [[6, "1:0m 2:0h 3:0h 6:0b"]]   // Schlussakkord e-Moll
];

window.SONGS = window.SONGS.concat([{
  id: "romanza",
  title: "Romanza",
  meta: "Spanische Romanze, anonym, 19. Jh. · 3/4-Takt in Achteltriolen · Teil 1 in e-Moll · gut für Anfänger: Melodie auf der hohen E-Saite, dazu leere Saiten",
  beats: 3, eighths: 6, refBpm: 76, defaultBpm: 50,
  sections: {
    A: { key: "e-Moll", measures: [0,1,2,3,4,5,6,7] },
    B: { key: "e-Moll", measures: [8,9,10,11,12,13,14,15] }
  },
  form: ["A","B"],
  formShort: ["A","B"],
  measures: RZ.map(M)
}]);

})();
