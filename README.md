# 🤥 Lügenbaron

Online-Partyspiel für 3–10 Freunde (ab 18, schwarzer Humor). Jeder spielt im Browser am eigenen Gerät, gequatscht wird nebenbei auf Discord.

## Spielablauf
1. **Insider-Runde** (optional): Jeder schreibt bis zu 3 eigene Fragen über die Gruppe. `[Spieler]` wird durch einen zufälligen Namen ersetzt.
2. **Antwort-Runden**: Lustigste Antwort schreiben, dann abstimmen. Jede Stimme bringt +100. Eine Antwort ist heimlich vom Haus, wer sie wählt, bekommt −100.
3. **Wer war's?**: Raten, wer was geschrieben hat, +50 pro Treffer.
4. **Wer würde am ehesten…?**: Einen Spieler wählen. Wer mit der Mehrheit stimmt, bekommt +100.
5. **Zeichen-Runden**: Kritzeln statt schreiben.
6. **Finale**: doppelte Punkte. Danach Siegerehrung mit Ehrentiteln, und der Letzte bekommt eine Strafe.

## Lokal starten
```bash
npm install
npm start
```
Dann http://localhost:3000 öffnen.

## Kostenlos online stellen (Render)
1. Projekt in ein GitHub-Repository hochladen.
2. Auf https://render.com mit GitHub anmelden.
3. **New → Blueprint** wählen und das Repository auswählen. `render.yaml` erledigt den Rest.
4. Nach 2–3 Minuten gibt es einen Link wie `https://luegenbaron.onrender.com`.

Hinweis: Im Gratis-Tarif schläft der Server nach 15 Minuten ohne Besucher ein. Der erste Aufruf dauert dann ca. 1 Minute. Am besten vor dem Spieleabend einmal öffnen.

## Eigene Fragen hinzufügen
Alles steht in `content.js`: Antwortfragen samt Haus-Antwort, „Wer würde am ehesten“-Fragen, Zeichenaufgaben und Strafen.
