# Gitarren-Tab-Trainer

Gitarre üben ohne Noten: Tabulatur, Griffbrett-Anzeige, Schritt-für-Schritt-Modus, Tempo-Regler und Klang direkt im Browser.

## Lokal starten
Einfach `index.html` im Browser öffnen, oder:

```
python3 -m http.server 8000
```

## Struktur
- `index.html` – Seite
- `css/style.css` – Gestaltung
- `js/songs.js` – Songdaten (hier neue Stücke eintragen)
- `js/app.js` – Griffbrett, Tabulatur, Audio und Wiedergabe

## Neues Stück hinzufügen
In `js/songs.js` ein Objekt an `window.SONGS` anhängen. Jeder Takt ist eine Liste von Schritten:
`[Dauer in Achteln, "Saite:Bund+Stimme[~Technik] ..."]`, z. B. `[1, "1:4m 4:2b"]`.
Stimme: `m` Melodie, `h` Harmonie, `b` Bass. Technik: `~s` Slide, `~h` Hammer-on, `~p` Pull-off.

## Deployment
Statische Seite ohne Build-Schritt. Netlify liest `netlify.toml` (Publish-Ordner `.`).
