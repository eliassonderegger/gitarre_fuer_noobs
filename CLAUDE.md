# Gitarre für Noobs – Hinweise für Claude

Statische Website (kein Build), gehostet über Netlify (Gratis-Plan, Auto-Deploy bei Push auf `main`).
Ziel: Gitarrenstücke üben mit Tabulatur statt Noten, Griffbrett-Anzeige, Schrittmodus, Tempo und Klang.
UI-Sprache: Deutsch (Schweizer Schreibweise, kein ß).

## Struktur
- `index.html` – Markup
- `css/style.css` – Design-Tokens in `:root`, Hell/Dunkel-Modus
- `js/songs.js` – alle Songdaten (`window.SONGS`)
- `js/app.js` – Griffbrett (SVG), Tabulatur (SVG), Audio (Karplus-Strong), Wiedergabe-Engine

## Neuen Song hinzufügen
In `js/songs.js` ein Objekt an `window.SONGS` anhängen (siehe Lágrima als Vorlage):
- `sections`: Teile mit Tonart und Taktindizes, `form` (mit Wiederholungen) und `formShort`
- `beats` / `eighths`: Schläge bzw. Achtel pro Takt; `refBpm` (Originaltempo), `defaultBpm`
- Takte: `M([[Dauer in Achteln, "Saite:Bund+Stimme[~Technik] ..."], ...])`
  - Saite 1 = hohe E, 6 = tiefe E; Stimme `m` Melodie, `h` Harmonie, `b` Bass
  - Technik `~s` Slide, `~h` Hammer-on, `~p` Pull-off
- Die Summe der Dauern pro Takt muss `eighths` ergeben. Triolen: Dauer `2/3` (siehe Romanza, Hilfsfunktion `R`).
- Nur gemeinfreie Stücke (Komponist > 70 Jahre tot) oder eigene Arrangements einbauen.

## Arbeitsweise
- Vor dem Push lokal mit Playwright laden und prüfen (keine Konsolenfehler, Takte zählen).
- Jeder Push auf `main` löst ein Netlify-Deployment aus und verbraucht Kontingent: Änderungen bündeln.

## Gestaltung
- Mid-Century-Stil: keine runden Ecken (nur Notenpunkte sind Kreise), flache Farbflächen, Farbband unter dem Kopf.
- Farben: Ochsenblut-Rot (Melodie), Tannengrün (Harmonie), Senfgelb (Bass) auf warmem Papierton; dunkles Holz-Griffbrett.
- Schrift: Jost (geometrisch) für alles, DM Mono für Tab-Zahlen. Keine generischen „AI-Look“-Muster.
- Beim Springen/Schritt kein Ton (Schalter „Ton beim Springen“, standardmässig aus).
