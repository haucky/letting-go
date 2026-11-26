# Loslassen

Meditations-PWA nach David R. Hawkins' *Letting Go*: spüren, benennen, da sein lassen. Für Android Chrome gebaut.

## Ablauf

1. **Reinspüren** (z. B. 30 s)
2. **Benennen**: eine Kachel antippen, ein eigenes Wort eintippen oder eine Aufnahme sprechen (geht auch kombiniert)
3. **Loslassen** (z. B. 2 Min), mit zwei großen Knöpfen:
   - **Gefühl verstärken**: Gemini zieht aus der Aufnahme 4–6 Glaubenssätze, unterschiedlich formuliert. Pocket TTS spricht sie ein, und sie werden der Reihe nach abgespielt.
   - **In den Körper**: feste Anker-Sätze für den Fall, dass du dissoziiert bist
4. **Mehr Zeit** oder **Neu reinspüren**

**Sedona-Modus** (Option auf dem Startscreen): Statt des Timers kommen Leitfragen, die du selbst mit „Nächste Frage“ weiterschaltest. Ein Zyklus hat vier Fragen: Zulassen, Könntest du, Würdest du, Wann. Gemini schreibt sie passend zu deiner Aufnahme, bis zu drei Zyklen zu verschiedenen Aspekten. Die beiden Knöpfe „Gefühl verstärken“ und „In den Körper“ bleiben.

**Liebe-Knopf**: Er spielt eigene Musik aus den Einstellungen (in IndexedDB gespeichert) mit weicher Ein- und Ausblendung. Ohne eigene Musik spielt ein synthetischer Klangteppich.

**Ansagen** (Gong-Begleittexte und Impulse) sind standardmäßig aus und lassen sich auf dem Startscreen einschalten.

## Einrichtung

1. GitHub Pages für den Branch `main` (Root) aktivieren.
2. Die Seite in Android Chrome öffnen und über das Menü „Zum Startbildschirm hinzufügen“ wählen.
3. Unter **Einstellungen**:
   - Gemini-API-Key eintragen (aistudio.google.com/apikey). Er wird nur im localStorage des Geräts gespeichert.
   - Optional die eigene Stimme mit dem Referenztext aufnehmen und auf „Als Stimme verwenden“ tippen.
   - „Modell laden und Ansagen vorbereiten“ antippen. Das lädt einmalig ca. 180–220 MB von Hugging Face.

## Speicher

| Was | Wo |
| --- | --- |
| Einstellungen, eigene Gefühle, Sitzungsprotokolle | localStorage (Export/Import als JSON) |
| Referenzaufnahme der Stimme, vorbereitete Ansagen | IndexedDB |
| TTS-Modell | Cache API (`pocket-tts-onnx`), dauerhaft per `navigator.storage.persist()` |

Der Service Worker setzt COOP/COEP-Header. Ab dem zweiten Öffnen ist die Seite deshalb cross-origin-isolated, und onnxruntime rechnet mit mehreren Threads.

## Neu bauen (vendor/)

```
npm i pocket-tts-onnx esbuild
npx esbuild node_modules/pocket-tts-onnx/dist/browser.js --bundle --format=esm --platform=browser --minify --outfile=vendor/pocket-tts.js
npx esbuild node_modules/pocket-tts-onnx/dist/worker.js --bundle --format=esm --platform=browser --minify --external:module --external:fs --external:path --external:url --external:worker_threads --outfile=vendor/pocket-tts-worker.js
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{mjs,wasm} vendor/ort/
```

Pocket TTS: Kyutai, ONNX-Port von thewh1teagle, CC BY 4.0. Klone nur deine eigene Stimme.
