// Loslassen — Meditations-PWA nach David R. Hawkins' "Letting Go"
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Inhalte ----------
const FEEL = ['Druck', 'Enge', 'Unruhe', 'Angst', 'Gehetzt', 'Gedanken', 'Ärger', 'Schwere', 'Traurig', 'Weiß nicht'];
const PROMPTS = ['Lass es ganz da sein.', 'Du musst nichts daran ändern.', 'Spür die Energie dahinter, nicht die Gedanken.', 'Wo im Körper sitzt es?', 'Lass auch den Widerstand da sein.', 'Darf es gehen?', 'Nur dieses Gefühl. Nichts sonst.'];
const SAY = { feel: 'Spür rein. Was ist gerade da?', choose: 'Was willst du loslassen?', check: 'Wie ist es jetzt?', end: 'Die Zeit ist um.' };
const ANCHORS = ['Spür deine Füße auf dem Boden.', 'Spür das Gewicht deines Körpers auf der Unterlage.', 'Ein Atemzug. Spür, wie die Luft einströmt.', 'Spür deine Hände. Wärme, Kribbeln, Gewicht.', 'Hör ein Geräusch im Raum. Du bist hier.', 'Wo ist gerade die stärkste Empfindung im Körper?', 'Spür dein Gesicht, deinen Kiefer, deine Schultern.'];
const FIXED = [...Object.values(SAY), ...PROMPTS, ...ANCHORS];
const REF_TEXT = 'Ich sitze ruhig da und spüre, was gerade in mir ist. Da ist ein leichter Druck in der Brust, vielleicht auch etwas Enge im Bauch. Ich muss nichts daran ändern. Ich lasse es einfach da sein, so wie es ist, und atme weiter. Gedanken kommen und gehen, und ich bleibe bei dem Gefühl.';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

// ---------- Speicher ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const S = Object.assign({ total: 20, feel: 30, let: 120, voice: 'pocket', pv: 'juergen', key: '', model: DEFAULT_MODEL, person: 'mix', cloneId: 0, announce: false, mode: 'timer' }, LS.get('ll-set', {}));
const saveS = () => LS.set('ll-set', S);
let OWN = LS.get('ll-own', []);           // [{name, created, count}]
const saveOwn = () => LS.set('ll-own', OWN);

const idb = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('loslassen', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', mode); const req = fn(t.objectStore('kv'));
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
    });
  };
  return {
    get: k => run('readonly', s => s.get(k)).catch(() => undefined),
    set: (k, v) => run('readwrite', s => s.put(v, k)).catch(() => {}),
    getStrict: k => run('readonly', s => s.get(k)),          // wirft Fehler weiter
    setStrict: (k, v) => run('readwrite', s => s.put(v, k)),
    del: k => run('readwrite', s => s.delete(k)).catch(() => {})
  };
})();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

// ---------- Audio ----------
let ac = null, curSrc = null;
function audioCtx() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  try { ac && ac.state === 'suspended' && ac.resume(); } catch (e) {}
  return ac;
}
function gong(soft) {
  const c = audioCtx();
  try {
    if (c) {
      const t = c.currentTime;
      [[196, 1], [294, .45], [392.5, .22], [589, .08]].forEach(([f, g]) => {
        const o = c.createOscillator(), v = c.createGain();
        o.type = 'sine'; o.frequency.value = f;
        v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime((soft ? .12 : .25) * g, t + .015);
        v.gain.exponentialRampToValueAtTime(.0001, t + 5);
        o.connect(v).connect(c.destination); o.start(t); o.stop(t + 5.1);
      });
    }
  } catch (e) {}
  try { navigator.vibrate && navigator.vibrate(soft ? [80] : [120, 90, 120]); } catch (e) {}
}
function stopVoice() {
  try { curSrc && curSrc.stop(); } catch (e) {} curSrc = null;
  try { speechSynthesis.cancel(); } catch (e) {}
}
function playSamples(a, delay = 0) {
  const c = audioCtx(); if (!c || !a) return;
  stopVoice();
  const b = c.createBuffer(1, a.s.length, a.r); b.copyToChannel(a.s, 0);
  const src = c.createBufferSource(); src.buffer = b; src.connect(c.destination);
  src.start(c.currentTime + .05 + delay); curSrc = src;
}
function browserSpeak(t) {
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'de-DE'; u.rate = .85; u.pitch = .95; speechSynthesis.speak(u); } catch (e) {}
}
function normalize(s) {
  let sum = 0, peak = 0;
  for (const x of s) { sum += x * x; const a = Math.abs(x); if (a > peak) peak = a; }
  const rms = Math.sqrt(sum / Math.max(1, s.length)) || 1e-6;
  const g = Math.min(0.1 / rms, 0.89 / (peak || 1));   // ca. −20 dBFS RMS, Spitze < −1 dB
  const out = new Float32Array(s.length + 0); for (let i = 0; i < s.length; i++) out[i] = s[i] * g;
  return out;
}
// Mikrofon-Aufnahme → AudioBuffer
let rec = null;
async function recStart() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const mr = new MediaRecorder(stream); const chunks = [];
  mr.ondataavailable = e => e.data.size && chunks.push(e.data);
  mr.start(250);
  rec = { stream, mr, chunks, t0: Date.now() };
}
async function recStop() {
  if (!rec) return null;
  const { stream, mr, chunks, t0 } = rec; rec = null;
  await new Promise(r => { mr.onstop = r; try { mr.stop(); } catch (e) { r(); } });
  stream.getTracks().forEach(t => t.stop());
  const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
  const c = audioCtx() || new AudioContext();
  const buffer = await c.decodeAudioData(await blob.arrayBuffer());
  return { buffer, seconds: (Date.now() - t0) / 1000 };
}
async function toMono(buffer, rate, maxSec = 1e9) {
  const len = Math.min(buffer.duration, maxSec);
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(len * rate)), rate);
  const src = off.createBufferSource(); src.buffer = buffer; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0).slice();
}
function wavBytes(s, rate) {
  const n = s.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s[i])) * 32767, true);
  return new Uint8Array(buf);
}
function wavBase64(s, rate) {
  const bytes = wavBytes(s, rate); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------- Ordner (File System Access, Chrome Android ab 132) ----------
const AUDIO_RE = /\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)$/i;
let dir = null, dirOk = false;
const VOICES = [];                                 // {id, name, src: builtin|app|folder, file?, h?}
const folderTracks = { liebe: [], wut: [] };
async function perm(h, ask) {
  try {
    if (!h.queryPermission) return true;
    const o = { mode: 'readwrite' };
    if (await h.queryPermission(o) === 'granted') return true;
    if (ask) return (await h.requestPermission(o)) === 'granted';
  } catch (e) {}
  return false;
}
const sub = name => dir.getDirectoryHandle(name, { create: true });
async function readJSON(d, name, def) { try { return JSON.parse(await (await (await d.getFileHandle(name)).getFile()).text()); } catch (e) { return def; } }
async function writeFile(d, name, data) { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); }
async function listAudio(d) { const out = []; for await (const [name, h] of d.entries()) if (h.kind === 'file' && AUDIO_RE.test(name)) out.push({ name, h }); return out.sort((a, b) => a.name.localeCompare(b.name, 'de')); }
const baseName = f => f.replace(/\.[a-z0-9]+$/i, '');
const slug = n => n.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'stimme';
function dirMsg(t) { const e = $('dirStatus'); if (e) e.textContent = t; }

async function initFolder() {
  dir = (await idb.get('dirHandle')) || null;
  dirOk = dir ? await perm(dir, false) : false;
  if (dirOk) await scanFolder().catch(e => dirMsg('Fehler beim Einlesen: ' + (e.message || e)));
  buildVoices(); syncStart();
}
async function ensureFolder() {              // nur aus einem Klick heraus aufrufen
  if (!dir || dirOk) return dirOk;
  dirOk = await perm(dir, true);
  if (dirOk) { await scanFolder().catch(() => {}); buildVoices(); }
  return dirOk;
}
async function scanFolder() {
  if (!dir || !dirOk) return;
  const [sd, ld, wd] = [await sub('stimmen'), await sub('liebe'), await sub('wut')]; await sub('daten');
  // Stimmen + stimmen.json abgleichen
  const meta = await readJSON(sd, 'stimmen.json', { stimmen: [] });
  const list = Array.isArray(meta.stimmen) ? meta.stimmen.filter(x => x && x.datei) : [];
  const files = await listAudio(sd); let changed = false;
  for (const f of files) if (!list.some(x => x.datei === f.name)) { list.push({ name: baseName(f.name).replace(/[-_]+/g, ' '), datei: f.name }); changed = true; }
  const fv = [];
  for (const x of list) {
    const f = files.find(y => y.name === x.datei); if (!f) continue;
    const file = await f.h.getFile();
    fv.push({ id: `f:${x.datei}:${file.lastModified}`, name: String(x.name || baseName(x.datei)), src: 'folder', file: x.datei, h: f.h });
  }
  if (changed) await writeFile(sd, 'stimmen.json', JSON.stringify({ stimmen: list }, null, 2));
  folderVoices = fv;
  folderTracks.liebe = (await listAudio(ld)).map(f => ({ id: 'f:liebe/' + f.name, name: f.name, h: f.h, src: 'folder' }));
  folderTracks.wut = (await listAudio(wd)).map(f => ({ id: 'f:wut/' + f.name, name: f.name, h: f.h, src: 'folder' }));
  dirMsg(`Verbunden mit „${dir.name}“: ${fv.length} Stimme(n), ${folderTracks.liebe.length} Lied(er) Liebe, ${folderTracks.wut.length} Lied(er) Wut.`);
}
let folderVoices = [];
function buildVoices() {
  VOICES.length = 0;
  VOICES.push({ id: 'juergen', name: 'Jürgen (eingebaut)', src: 'builtin' });
  if (S.cloneId) VOICES.push({ id: 'app:' + S.cloneId, name: 'Meine Stimme (in der App)', src: 'app' });
  VOICES.push(...folderVoices);
}
$('dirPick').onclick = async () => {
  if (!('showDirectoryPicker' in window)) { dirMsg('Dieser Browser kann keine Ordner öffnen. Chrome auf Android ab Version 132 nötig.'); return; }
  try {
    const h = await window.showDirectoryPicker({ id: 'loslassen', mode: 'readwrite', startIn: 'documents' });
    dir = h; dirOk = true; await idb.setStrict('dirHandle', h).catch(() => {});
    await scanFolder(); buildVoices(); renderVoices(); renderAllMusic(); await saveDataToFolder();
  } catch (e) { if (e.name !== 'AbortError') dirMsg('Ordner nicht verfügbar: ' + (e.message || e.name)); }
};
$('dirScan').onclick = async () => {
  if (!dir) return dirMsg('Erst einen Ordner wählen.');
  if (!(await ensureFolder())) return dirMsg('Kein Zugriff. Tippe auf „Ordner wählen“ und wähle denselben Ordner erneut.');
  await scanFolder(); buildVoices(); renderVoices(); renderAllMusic();
};
async function saveDataToFolder() {
  if (!dir || !dirOk) return;
  try { await writeFile(await sub('daten'), 'loslassen-daten.json', JSON.stringify(exportData(), null, 2)); } catch (e) {}
}

// ---------- Pocket TTS ----------
let engine = null, enginePromise = null, clonedId = null;
let ttsChain = Promise.resolve();
const promptCache = new Map(), sampleCache = new Map();
if (!S.roles) S.roles = { base: S.pv === 'cloned' && S.cloneId ? 'app:' + S.cloneId : 'juergen', strengthen: 'base', questions: 'base' };
function roleVoice(role) {
  let id = S.roles[role]; if (!id || id === 'base') id = S.roles.base;
  return VOICES.some(v => v.id === id) ? id : 'juergen';
}
async function voiceSamples(id) {
  if (id === 'juergen') return null;
  if (sampleCache.has(id)) return sampleCache.get(id);
  const v = VOICES.find(x => x.id === id); if (!v) return null;
  let s = null;
  if (v.src === 'app') s = await idb.get('refVoice');
  if (v.src === 'folder') {
    const buf = await (await v.h.getFile()).arrayBuffer();
    s = await toMono(await (audioCtx() || new AudioContext()).decodeAudioData(buf), 24000, 20);
  }
  if (s) sampleCache.set(id, s);
  return s;
}
function getEngine(onProgress) {
  if (engine) return Promise.resolve(engine);
  if (!enginePromise) {
    enginePromise = (async () => {
      const m = await import('./vendor/pocket-tts.js');
      engine = await m.Engine.load({
        language: 'german',
        ortWasmUrl: new URL('./vendor/ort/', location.href).href,
        worker: () => new Worker(new URL('./vendor/pocket-tts-worker.js', location.href), { type: 'module' }),
        onProgress: (stage, p) => onProgress && onProgress(stage, p)
      });
      return engine;
    })().catch(err => { enginePromise = null; throw err; });
  }
  return enginePromise;
}
// Der Worker hält immer nur eine geklonte Stimme: bei Wechsel neu klonen (dauert kurz).
function synth(text, vid = roleVoice('base'), onProgress) {
  const job = ttsChain.then(async () => {
    const e = await getEngine(onProgress);
    let voice = e.defaultVoice;
    const smp = await voiceSamples(vid).catch(() => null);
    if (smp) { if (clonedId !== vid) { await e.clone(smp, onProgress); clonedId = vid; } voice = smp; }
    const frames = [];
    for await (const f of e.speak(text, voice)) frames.push(f);
    let n = 0; frames.forEach(f => n += f.length);
    const s = new Float32Array(n); let o = 0; frames.forEach(f => { s.set(f, o); o += f.length; });
    return { s: normalize(s), r: e.sampleRate };
  });
  ttsChain = job.catch(() => {});
  return job;
}
async function loadPromptCache() {
  const k = roleVoice('base');
  for (const t of FIXED) {
    if (promptCache.has(k + '|' + t)) continue;
    const a = await idb.get('p|' + k + '|' + t);
    if (a) promptCache.set(k + '|' + t, a);
  }
}
async function prepareAll(onStep) {
  await getEngine(onStep);
  await loadPromptCache();
  const k = roleVoice('base'); let i = 0;
  for (const t of FIXED) {
    i++;
    if (!promptCache.has(k + '|' + t)) {
      const a = await synth(t, k, onStep);
      promptCache.set(k + '|' + t, a); await idb.set('p|' + k + '|' + t, a);
    }
    onStep && onStep('prompts', { loaded: i, total: FIXED.length });
  }
}
// Text ausgeben: vorbereitete Datei > KI-Stimme live > Browser-Stimme
function say(text) {
  if (S.voice === 'off') return;
  if (S.voice === 'pocket') {
    const a = promptCache.get(roleVoice('base') + '|' + text);
    if (a) return playSamples(a);
    if (engine) return void synth(text).then(a => { if (state !== 'start') playSamples(a); }).catch(() => browserSpeak(text));
  }
  browserSpeak(text);
}

const announce = t => { if (S.announce) say(t); };

// ---------- Gemini ----------
function fallbackQuestions(f) {
  const w = f && f !== '…' ? f : 'dieses Gefühl';
  return [`Kannst du ${w} gerade einfach da sein lassen?`, `Könntest du ${w} loslassen?`, `Würdest du ${w} loslassen?`, 'Wann?',
    `Steckt unter ${w} ein Wunsch nach Anerkennung, Kontrolle oder Sicherheit?`, 'Könntest du diesen Wunsch loslassen?', 'Würdest du?', 'Wann?'];
}
function fallbackSentences(f) {
  const w = f && f !== '…' ? f : 'dieses Gefühl';
  return [`Da ist ${w}.`, `${w}. Genau jetzt.`, `Wann war ${w} heute schon da?`, `Lass ${w} noch einmal ganz hochkommen.`];
}
const FORM = {
  mix: 'Mische die Formen bewusst: Du-Form, wie eine innere Stimme sie sagt ("Du schaffst das nie."), Ich-Form als eigene Überzeugung ("Ich bin nicht gut genug."), als nackte Behauptung ("Das wird nichts.") und als Befürchtung ("Gleich merken alle, dass …"). Jede Form kann einen anderen Nerv treffen.',
  ich: 'Ich-Form, als eigene Überzeugung ("Ich bin nicht gut genug.", "Ich schaffe das nie.").',
  du: 'Du-Form, wie eine innere Stimme sie sagt ("Du bist nichts wert.", "Du schaffst das nie.").'
};
async function gemini(feeling, audioB64) {
  const prompt = `Du unterstützt eine Meditation nach David R. Hawkins ("Letting Go"). Beim Loslassen lasse ich ein Gefühl ganz hochkommen und da sein, ohne mich dagegen zu wehren, bis es sich auflöst. Dafür muss das Gefühl spürbar sein.
Benanntes Gefühl/Zustand: "${feeling === '…' ? 'noch nicht benannt' : feeling}".
${audioB64 ? 'Im Audio spreche ich aus, was ich gerade loslassen will und welche Gedanken dazu kommen.' : 'Es gibt keine Aufnahme. Leite die Sätze aus typischen Überzeugungen hinter diesem Gefühl ab, eher zurückhaltend.'}

Aufgaben:
1. ${audioB64 ? 'Transkribiere das Audio wörtlich auf Deutsch in "transcript".' : 'Setze "transcript" auf einen leeren String.'}
2. Benenne das Gefühl in "label" mit ein bis drei Wörtern.
3. Schreibe 4 bis 6 kurze Sätze in "sentences". Ich drücke einen Knopf "Gefühl verstärken", wenn ich mich in anderen Gedanken verloren habe, und bekomme dann einen dieser Sätze vorgelesen. Jeder Satz soll das Gefühl wieder aufflammen lassen, damit ich es loslassen kann.

So entstehen die Sätze:
- Zieh aus dem Audio die Glaubenssätze, Befürchtungen, Selbstvorwürfe und Situationen, die darin stecken oder angedeutet sind, und sprich sie direkt und unverblümt aus (z. B. "Du bist nichts wert.", "Du wirst das nie schaffen.", "Alle anderen kriegen das hin.").
- ${FORM[S.person] || FORM.mix}
- Verschiedene Sätze sollen verschiedene Glaubenssätze oder Seiten davon treffen, nicht dasselbe fünfmal.
- Präsens, höchstens 10 Wörter, gesprochene Sprache. Konkrete Situationen und meine eigenen Wörter aus dem Audio nutzen, wo möglich.
- Nur, was im Audio oder im Gefühl angelegt ist: nichts Härteres erfinden, keine Themen dazudichten.
- Keine Körperanweisungen, keine Ratschläge, keine Lösungen, kein Trost, keine Relativierung, keine Fragen.

4. Schreibe Leitfragen nach der Sedona-Methode in "questions": 2 bis 3 Zyklen mit je 4 Fragen in dieser Reihenfolge:
   a) Zulassen: "Kannst du … gerade da sein lassen / willkommen heißen?"
   b) "Könntest du … loslassen?"
   c) "Würdest du … loslassen?"
   d) "Wann?" (darf leicht variieren, z. B. "Wann würdest du … loslassen?")
   Jeder Zyklus nimmt einen anderen konkreten Aspekt aus dem Audio (Situation, Glaubenssatz, Befürchtung) und nennt ihn in den Fragen beim Namen, z. B. "Könntest du die Unsicherheit wegen der Hausarbeit loslassen?". Ein Zyklus darf stattdessen nach dem Wunsch darunter fragen (Anerkennung, Kontrolle oder Sicherheit), z. B. "Könntest du den Wunsch loslassen, dass dein Dozent dich gut findet?".
   Du-Form, höchstens 14 Wörter, warm und direkt, keine Erklärungen. Die Fragen sollen berühren, nicht abstrakt sein.`;
  const parts = [{ text: prompt }];
  if (audioB64) parts.push({ inline_data: { mime_type: 'audio/wav', data: audioB64 } });
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.6, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { transcript: { type: 'STRING' }, label: { type: 'STRING' }, sentences: { type: 'ARRAY', items: { type: 'STRING' } }, questions: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['label', 'sentences', 'questions'] }
    }
  };
  const model = (S.model || DEFAULT_MODEL).trim();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': S.key.trim() }, body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
  const txt = (((j.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('') || '';
  const out = JSON.parse(txt);
  out.sentences = (out.sentences || []).map(s => String(s).trim()).filter(Boolean).slice(0, 6);
  if (!out.sentences.length) throw new Error('keine Sätze erhalten');
  out.questions = (out.questions || []).map(s => String(s).trim()).filter(Boolean).slice(0, 12);
  return out;
}

// ---------- Musik (Liebe- und Wut-Knopf) ----------
const CATS = ['liebe', 'wut'];
let appTracks = [];              // [{id, name, cat, size}] – Daten in IndexedDB unter 'm|<id>'
let music = null;                // {cat, el|pad, url, id, name, fadeT}
const posMemo = {};
async function loadTracks() { appTracks = ((await idb.get('tracks')) || []).map(t => ({ cat: 'liebe', ...t })); }
const saveAppTracks = () => idb.set('tracks', appTracks.map(({ broken, why, ...t }) => t));
const tracksOf = cat => [...(folderTracks[cat] || []), ...appTracks.filter(t => t.cat === cat)];
if (!S.musicSel) S.musicSel = { liebe: S.music || '', wut: '' };
function pickTrack(cat) {
  const list = tracksOf(cat); if (!list.length) return null;
  const sel = S.musicSel[cat];
  if (sel === 'rotate') { S.musicIdx = S.musicIdx || {}; S.musicIdx[cat] = ((S.musicIdx[cat] || 0) + 1) % list.length; saveS(); return list[S.musicIdx[cat]]; }
  return list.find(t => String(t.id) === String(sel)) || list[0];
}
function fade(m, to, ms, done) {
  clearInterval(m.fadeT);
  const el = m.el, from = el.volume, t0 = Date.now();
  m.fadeT = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / ms); el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k >= 1) { clearInterval(m.fadeT); done && done(); }
  }, 50);
}
function makePad(cat) {
  const c = audioCtx(); if (!c) return null;
  const out = c.createGain(); out.gain.value = 0; out.connect(c.destination);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.connect(out);
  let oscs;
  if (cat === 'wut') {                                   // dunkel, rau, pulsierend wie ein schneller Herzschlag
    lp.frequency.value = 420; lp.Q.value = 6;
    const pulse = c.createGain(); pulse.gain.value = 0.5; pulse.connect(lp);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.type = 'square'; lfo.frequency.value = 1.8; lg.gain.value = 0.45;
    lfo.connect(lg).connect(pulse.gain); lfo.start();
    oscs = [55, 82.41, 110.5].map((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = i * 7; g.gain.value = 0.09; o.connect(g).connect(pulse); o.start(); return o; });
    oscs.push(lfo);
  } else {                                               // warm, F-Dur, sanft schwebend
    lp.frequency.value = 900;
    oscs = [174.61, 220, 261.63, 349.23, 440].flatMap((f, i) => [-3, 3].map(d => {
      const o = c.createOscillator(), g = c.createGain(); o.type = i < 2 ? 'sine' : 'triangle';
      o.frequency.value = f; o.detune.value = d; g.gain.value = 0.05 / (1 + i * .4);
      const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 0.07 + i * 0.03; lg.gain.value = 0.02;
      l.connect(lg).connect(g.gain); o.connect(g).connect(lp); o.start(); l.start(); return [o, l];
    })).flat();
  }
  return { out, oscs, c };
}
const AUDIO_TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm' };
const guessType = name => AUDIO_TYPES[(name.split('.').pop() || '').toLowerCase()] || '';
// Ordner-Lieder kommen über den Datei-Handle, App-Lieder als Kopie aus IndexedDB.
// Ältere Versionen haben File-Objekte gespeichert; lesbare werden in eine echte Kopie umgewandelt.
async function trackBlob(t) {
  if (t.h) {
    if (!(await perm(dir, false))) throw new Error('kein Zugriff mehr auf den Ordner, bitte neu verbinden');
    try { return await t.h.getFile(); } catch (e) { throw new Error('Datei im Ordner nicht lesbar (' + (e && e.name || e) + ')'); }
  }
  let rec;
  try { rec = await idb.getStrict('m|' + t.id); } catch (e) { throw new Error('Speicher nicht lesbar (' + (e && e.name || e) + ')'); }
  if (!rec) throw new Error('Datei fehlt im App-Speicher');
  if (rec.buf) return new Blob([rec.buf], { type: rec.type || guessType(t.name) });
  if (rec instanceof Blob) {
    let buf;
    try { buf = await rec.arrayBuffer(); } catch (e) { throw new Error('Datei nicht mehr lesbar, keine Berechtigung (' + (e && e.name || e) + ')'); }
    const type = rec.type || guessType(t.name);
    try { await idb.setStrict('m|' + t.id, { buf, type, size: buf.byteLength }); } catch (e) {}
    return new Blob([buf], { type });
  }
  throw new Error('unbekanntes Format im Speicher');
}
let musicError = '';
async function startMusic(cat) {
  audioCtx(); musicError = '';
  const t = pickTrack(cat);
  if (t) {
    try {
      const blob = await trackBlob(t);
      const url = URL.createObjectURL(blob); const el = new Audio(url); el.loop = true; el.volume = 0;
      el.currentTime = posMemo[t.id] || 0;
      music = { cat, el, url, id: t.id, name: t.name };
      try { await el.play(); } catch (e) { stopMusicNow(); throw new Error('Abspielen fehlgeschlagen (' + (e && e.name || e) + ')'); }
      fade(music, 0.85, cat === 'wut' ? 2000 : 4000); return true;
    } catch (e) { musicError = `„${t.name}“: ${e.message || e}.`; t.broken = true; t.why = e.message; }
  }
  const pad = makePad(cat); if (!pad) return false;
  music = { cat, pad, name: musicError ? 'Klang (Musik fehlt)' : 'Klang' };
  pad.out.gain.setTargetAtTime(cat === 'wut' ? 0.7 : 0.55, pad.c.currentTime, cat === 'wut' ? 0.6 : 1.4); return true;
}
function release(m) {
  clearInterval(m.fadeT);
  if (m.el) { m.el.pause(); URL.revokeObjectURL(m.url); }
  if (m.pad) m.pad.oscs.forEach(o => { try { o.stop(); } catch (e) {} });
}
function stopMusicNow() { if (music) { const m = music; music = null; if (m.el) posMemo[m.id] = m.el.currentTime; release(m); } }
function stopMusic(ms = 3000) {
  if (!music) return setMusicBtns();
  const m = music; music = null;                     // sofort frei: nächster Tipp startet neu
  if (m.el) { posMemo[m.id] = m.el.currentTime + ms / 1000; fade(m, 0, ms, () => release(m)); }
  else { m.pad.out.gain.setTargetAtTime(0, m.pad.c.currentTime, ms / 4000); setTimeout(() => release(m), ms + 500); }
  setMusicBtns();
}
function setMusicBtns() {
  for (const cat of CATS) {
    const on = music && music.cat === cat, b = $(cat === 'liebe' ? 'bLove' : 'bWut');
    b.classList.toggle('on', !!on);
    $('info-' + cat).textContent = on ? baseName(music.name) + ' läuft' : (tracksOf(cat).length ? 'Musik' : 'Klang');
  }
}
async function toggleMusic(cat) {
  if (music && music.cat === cat) return stopMusic();
  if (music) stopMusic(1500);                          // andere Musik weich ausblenden
  await ensureFolder();
  if (!(await startMusic(cat))) music = null;
  setMusicBtns();
  if (musicError) $('said').textContent = musicError + ' Bitte in den Einstellungen prüfen.';
}
// Einstellungen: je Kategorie eine Karte
const card = cat => document.querySelector(`.card[data-cat="${cat}"]`);
function renderMusic(cat) {
  const c = card(cat), list = tracksOf(cat);
  c.querySelector('.mlist').innerHTML = list.length ? list.map(t => `<span class="chip">${esc(t.name)}${t.src === 'folder' ? ' <span class="small">Ordner</span>' : ''}${t.broken ? ' <b style="color:var(--rose)">(nicht lesbar)</b>' : t.size ? ` <span class="small">${(t.size / 1048576).toFixed(1)} MB</span>` : ''}${t.src === 'folder' ? '' : `<button data-mdel="${esc(t.id)}" aria-label="${esc(t.name)} löschen">×</button>`}</span>`).join('') : '<p class="small">Noch keine Musik.</p>';
  const sel = c.querySelector('.msel');
  sel.innerHTML = (list.length > 1 ? '<option value="rotate">Abwechselnd</option>' : '') + list.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('') + (list.length ? '' : '<option value="">Klang (synthetisch)</option>');
  const v = S.musicSel[cat];
  sel.value = v && (v === 'rotate' || list.some(t => String(t.id) === String(v))) ? v : (list[0] ? String(list[0].id) : '');
}
function renderAllMusic() { CATS.forEach(renderMusic); }
async function checkTracks() {
  for (const cat of CATS) {
    for (const t of tracksOf(cat)) { try { await trackBlob(t); t.broken = false; } catch (e) { t.broken = true; t.why = e.message; } }
    renderMusic(cat);
    const bad = tracksOf(cat).filter(t => t.broken);
    if (bad.length) card(cat).querySelector('.mout').textContent = `Nicht lesbar: ${bad.map(t => t.name + ' – ' + t.why).join('; ')}`;
  }
}
for (const cat of CATS) {
  const c = card(cat), out = c.querySelector('.mout');
  c.querySelector('.madd').onclick = () => c.querySelector('.mfile').click();
  c.querySelector('.mfile').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    const ok = [], bad = [];
    const toFolder = dir && await ensureFolder();
    for (const f of files) {
      out.textContent = `Kopiere „${f.name}“ ${toFolder ? 'in den Ordner' : 'in die App'} …`;
      try {
        if (toFolder) { await writeFile(await sub(cat), f.name, f); }
        else {
          const buf = await f.arrayBuffer();                     // echte Kopie, kein Verweis auf die Datei
          const id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
          await idb.setStrict('m|' + id, { buf, type: f.type || guessType(f.name), size: buf.byteLength });
          const back = await idb.getStrict('m|' + id);
          if (!back || !back.buf || back.buf.byteLength !== buf.byteLength) throw new Error('Gegenlesen fehlgeschlagen');
          appTracks.push({ id, name: f.name, size: buf.byteLength, cat });
        }
        ok.push(f.name);
      } catch (err) { bad.push(`${f.name} (${err && (err.name === 'QuotaExceededError' ? 'Speicher voll' : err.message || err.name)})`); }
    }
    await saveAppTracks(); if (toFolder) await scanFolder();
    renderMusic(cat);
    out.textContent = (ok.length ? `${ok.length} Stück(e) gespeichert${toFolder ? ' im Ordner ' + cat + '/' : ''}.` : '') + (bad.length ? ` Fehler: ${bad.join(', ')}` : '');
  };
  c.querySelector('.mlist').onclick = async e => {
    const b = e.target.closest('[data-mdel]'); if (!b) return;
    const i = appTracks.findIndex(t => String(t.id) === b.dataset.mdel); if (i < 0) return;
    const [t] = appTracks.splice(i, 1); await idb.del('m|' + t.id); await saveAppTracks(); renderMusic(cat);
  };
  c.querySelector('.msel').onchange = e => { S.musicSel[cat] = e.target.value; saveS(); };
  const tb = c.querySelector('.mtest');
  tb.onclick = async () => {
    if (music && music.cat === cat) { stopMusic(1500); tb.textContent = 'Probehören'; return; }
    if (music) stopMusic(800);
    CATS.forEach(k => card(k).querySelector('.mtest').textContent = 'Probehören');
    await ensureFolder(); await startMusic(cat); tb.textContent = 'Ausblenden';
    out.textContent = musicError || `Spielt: ${music ? music.name : '–'}`;
  };
}
loadTracks().then(() => initFolder());

// ---------- Sitzung ----------
let state = 'start', phaseEnd = 0, phaseLen = 1, sessionEnd = 0, sessionStart = 0, cur = null, log = [], pi = 0, nextPrompt = 0, wake = null, pending = null;

function show(id) { document.querySelectorAll('.screen').forEach(s => s.hidden = s.id !== id); state = id; }
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const hm = d => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
async function lock() { try { wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !['start', 'end', 'settings'].includes(state)) lock(); });
function phase(sec) { phaseLen = sec * 1000; phaseEnd = Date.now() + phaseLen; }
function ring(el, now) { $(el).setAttribute('stroke-dashoffset', String(Math.min(100, 100 * (1 - (phaseEnd - now) / phaseLen)))); }
const over = () => Date.now() >= sessionEnd;

async function begin() {
  if (dir && !dirOk) await ensureFolder();
  S.total = +$('oTotal').value; S.feel = +$('oFeel').value; S.let = +$('oLet').value; S.voice = $('oVoice').value; S.announce = $('oAnn').value === '1'; S.mode = $('oMode').value; saveS();
  audioCtx(); lock();
  log = []; sessionStart = Date.now(); sessionEnd = sessionStart + S.total * 60000;
  if (S.voice === 'pocket') { loadPromptCache(); getEngine().catch(() => {}); }
  gong(); setTimeout(toFeel, 60);
}
function toFeel() { if (over()) return finish(); show('feel'); phase(S.feel); announce(SAY.feel); }
function toChoose() { if (over()) return finish(); show('choose'); renderGrid(); setRecBtn(); gong(true); announce(SAY.choose); }

function renderGrid() {
  const own = OWN.filter(o => !FEEL.includes(o.name)).sort((a, b) => (b.count || 0) - (a.count || 0));
  $('grid').innerHTML = FEEL.map(f => `<button class="tile" data-f="${esc(f)}">${esc(f)}</button>`).join('') +
    own.map(o => `<button class="tile own" data-f="${esc(o.name)}">${esc(o.name)}</button>`).join('');
}
function rememberOwn(name) {
  if (FEEL.includes(name)) return;
  const o = OWN.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (o) o.count = (o.count || 0) + 1; else OWN.push({ name, created: new Date().toISOString(), count: 1 });
  saveOwn();
}

// Aufnahme im Auswahl-Screen
let recTimer = null;
function setRecBtn() {
  const b = $('bRec');
  if (rec) { b.className = 'rec on'; b.textContent = `Aufnahme läuft ${fmt(Date.now() - rec.t0)} · Stopp`; }
  else if (pending) { b.className = 'rec done'; b.textContent = `Aufnahme bereit (${Math.round(pending.seconds)} s) · neu aufnehmen`; }
  else { b.className = 'rec'; b.textContent = 'Aufnahme: sprich aus, was da ist'; }
}
async function stopChooseRec() {
  clearInterval(recTimer);
  if (!rec) return;
  const r = await recStop().catch(() => null);
  if (r && r.seconds > 0.8) pending = { seconds: r.seconds, b64: wavBase64(await toMono(r.buffer, 16000, 120), 16000) };
  setRecBtn();
}
$('bRec').onclick = async () => {
  if (rec) return stopChooseRec();
  stopVoice(); pending = null;
  try { await recStart(); } catch (e) { $('bRec').textContent = 'Mikrofon nicht erlaubt'; return; }
  setRecBtn(); recTimer = setInterval(() => { setRecBtn(); if (rec && Date.now() - rec.t0 > 120000) stopChooseRec(); }, 500);
};

async function pick(f) {
  f = String(f || '').trim();
  await stopChooseRec();
  if (!f && !pending) return;
  if (!f) f = '…';
  else rememberOwn(f);
  $('own').value = ''; $('own').blur();
  const audio = pending; pending = null;
  cur = { t: new Date().toISOString(), f, r: 1, gone: false, hadAudio: !!audio, transcript: '', sentences: fallbackSentences(f), source: 'standard', audio: [], idx: 0, questions: fallbackQuestions(f), qaudio: [], qi: 0 };
  log.push(cur);
  toLet();
  makeSentences(cur, audio);
}
async function makeSentences(entry, audio) {
  setBackInfo();
  if (S.key && S.key.trim()) {
    try {
      const out = await gemini(entry.f, audio && audio.b64);
      entry.sentences = out.sentences; entry.transcript = out.transcript || ''; entry.label = out.label || '';
      entry.source = 'gemini'; entry.idx = 0; entry.audio = [];
      if (out.questions.length >= 4) { entry.questions = out.questions; entry.qaudio = []; entry.qSwitch = true; }
      if (entry.f === '…' && out.label) { entry.f = out.label; if (cur === entry && state === 'let') setWord(entry.f); }
    } catch (e) { entry.source = 'standard'; entry.error = String(e.message || e); }
  }
  setBackInfo();
  if (S.voice === 'pocket') {
    const jobs = [['sentences', 'audio'], ['questions', 'qaudio']];
    if (S.mode === 'sedona') jobs.reverse();
    for (const [k, ak] of jobs) {
      const list = entry[k];
      for (let i = 0; i < list.length; i++) {
        if (entry[ak][i]) continue;
        try { const a = await synth(list[i], roleVoice(k === 'questions' ? 'questions' : 'strengthen')); if (entry[k] === list) entry[ak][i] = a; } catch (e) { return; }
        setBackInfo();
      }
    }
  }
}
// Sedona-Modus: selbst getaktete Leitfragen
function speakItem(text, store, i, role = 'questions') {
  if (S.voice === 'off') return;
  if (S.voice === 'pocket' && store[i]) return playSamples(store[i]);
  if (S.voice === 'pocket' && engine) return void synth(text, roleVoice(role)).then(a => { store[i] = store[i] || a; if (state === 'let') playSamples(a); }).catch(() => browserSpeak(text));
  browserSpeak(text);
}
function showQuestion(speak = true) {
  if (cur.qSwitch) { cur.qSwitch = false; cur.qi = 0; }
  const n = cur.questions.length, i = cur.qi % n;
  const p = $('letPrompt'); p.textContent = cur.questions[i];
  $('tL').textContent = `Frage ${i % 4 + 1} von 4 · Zyklus ${Math.floor(cur.qi / 4) + 1}`;
  $('rL').setAttribute('stroke-dashoffset', String(100 - 100 * ((i % 4) + 1) / 4));
  if (speak) speakItem(cur.questions[i], cur.qaudio, i);
}
function nextQuestion() { if (!cur) return; cur.qi++; $('said').textContent = ''; showQuestion(); }
function setBackInfo() {
  if (!cur) return;
  const n = cur.sentences.length, ready = cur.audio.filter(Boolean).length;
  let t = cur.source === 'gemini' ? `${n} Sätze${cur.hadAudio ? ' aus der Aufnahme' : ''}` : (S.key ? (cur.error ? 'Gemini-Fehler · Standard' : 'werden erstellt …') : `${n} Standardsätze`);
  if (S.voice === 'pocket' && ready < n) t += ` · vertont ${ready}/${n}`;
  $('backInfo').textContent = t;
}
let ai = 0;
function anchor() {
  const text = ANCHORS[ai++ % ANCHORS.length];
  $('said').textContent = text; nextPrompt = Date.now() + 30000;
  stopVoice(); say(text);
}
function backToFeeling() {
  if (!cur) return;
  const i = cur.idx % cur.sentences.length; cur.idx++;
  const text = cur.sentences[i];
  $('said').textContent = text;
  nextPrompt = Date.now() + 30000;      // Impulse nicht gleich darüber legen
  if (S.voice === 'off') return;
  if (S.voice === 'pocket' && cur.audio[i]) return playSamples(cur.audio[i]);
  if (S.voice === 'pocket' && engine) return void synth(text, roleVoice('strengthen')).then(a => { cur.audio[i] = cur.audio[i] || a; playSamples(a); }).catch(() => browserSpeak(text));
  browserSpeak(text);
}

function setWord(w) { const el = $('letWord'); el.textContent = w; el.classList.toggle('long', w.length > 11); }
function toLet() {
  const sed = S.mode === 'sedona';
  $('let').classList.toggle('sedona', sed);
  show('let'); setWord(cur.f); $('said').textContent = '';
  phase(S.let); pi = 0; nextPrompt = Date.now() + 24000;
  if (sed) { showQuestion(); }
  else { $('letPrompt').textContent = PROMPTS[0]; announce(PROMPTS[0]); }
  setBackInfo(); setMusicBtns();
}
function toCheck() {
  if (over()) return finish();
  show('check');
  $('moreLbl').textContent = S.mode === 'sedona' ? `weiter fragen zu „${cur.f}“` : `nochmal ${S.let >= 120 ? S.let / 60 + ' Min' : S.let + ' Sek'} mit „${cur.f}“`;
  gong(); announce(SAY.check);
}
function finish() {
  if (state === 'end') return;
  clearInterval(recTimer); if (rec) recStop().catch(() => {});
  stopMusic(4000);
  show('end'); gong(); announce(SAY.end);
  try { wake && wake.release(); } catch (e) {}
  const mins = Math.round((Date.now() - sessionStart) / 60000);
  $('sum').textContent = log.length ? `${mins} Min · ${log.length} Gefühle · ${log.reduce((a, b) => a + b.r, 0)} Runden Loslassen` : `${mins} Min · nichts notiert`;
  $('log').innerHTML = log.map(l => `<div class="row"><span class="t">${esc(hm(l.t))}</span><span class="fw">${esc(l.f)}</span><span class="n">${l.r}×${l.gone ? ' gegangen' : ''}</span>${l.transcript ? `<p class="d">„${esc(l.transcript)}“</p>` : ''}${l.source === 'gemini' ? `<p class="d">${l.sentences.map(esc).join(' · ')}</p>` : ''}</div>`).join('') || '<p class="small">Keine Einträge.</p>';
  const sessions = LS.get('ll-log', []);
  sessions.push({ start: new Date(sessionStart).toISOString(), minutes: mins, entries: log.map(({ audio, qaudio, idx, qSwitch, ...rest }) => rest) });
  LS.set('ll-log', sessions.slice(-200));
  saveDataToFolder();
}

setInterval(() => {
  if (['start', 'end', 'settings'].includes(state)) return;
  const now = Date.now(), rem = sessionEnd - now;
  const txt = rem > 0 ? `noch ${Math.ceil(rem / 60000)} Min` : 'Zeit ist um';
  document.querySelectorAll('.rest').forEach(e => e.textContent = txt);
  if (state === 'feel') { $('tF').textContent = fmt(phaseEnd - now); ring('rF', now); if (now >= phaseEnd) toChoose(); }
  else if (state === 'let' && S.mode === 'sedona') { /* selbst getaktet */ }
  else if (state === 'let') {
    $('tL').textContent = fmt(phaseEnd - now); ring('rL', now);
    if (now >= nextPrompt && phaseEnd - now > 8000) {
      pi = (pi + 1) % PROMPTS.length; const p = $('letPrompt'); p.style.opacity = 0;
      setTimeout(() => { p.textContent = PROMPTS[pi]; p.style.opacity = 1; }, 500);
      announce(PROMPTS[pi]); nextPrompt = now + 26000;
    }
    if (now >= phaseEnd) toCheck();
  } else if (state === 'choose' && rem <= 0 && !rec) finish();
}, 250);

// ---------- Export / Import ----------
function exportData() { return { app: 'loslassen', version: 3, exported: new Date().toISOString(), ownFeelings: OWN, sessions: LS.get('ll-log', []) }; }
function exportJSON() {
  const data = exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `loslassen-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$('xExport').onclick = exportJSON; $('bExport2').onclick = exportJSON;
$('xImport').onclick = () => $('xFile').click();
$('xFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    let added = 0;
    (d.ownFeelings || []).forEach(o => { if (o && o.name && !OWN.some(x => x.name.toLowerCase() === String(o.name).toLowerCase())) { OWN.push({ name: String(o.name), created: o.created || new Date().toISOString(), count: o.count || 0 }); added++; } });
    if (Array.isArray(d.sessions)) { const s = LS.get('ll-log', []); const seen = new Set(s.map(x => x.start)); d.sessions.forEach(x => { if (x && x.start && !seen.has(x.start)) s.push(x); }); LS.set('ll-log', s.slice(-200)); }
    saveOwn(); renderOwn(); saveDataToFolder(); $('xOut').textContent = `${added} Gefühle importiert.`;
  } catch (err) { $('xOut').textContent = 'Datei konnte nicht gelesen werden.'; }
  e.target.value = '';
};
function renderOwn() {
  $('ownList').innerHTML = OWN.length ? OWN.map((o, i) => `<span class="chip">${esc(o.name)}<button data-del="${i}" aria-label="${esc(o.name)} löschen">×</button></span>`).join('') : '<p class="small">Noch keine eigenen Einträge. Alles, was du selbst eintippst, landet hier.</p>';
}
$('ownList').onclick = e => { const b = e.target.closest('[data-del]'); if (!b) return; OWN.splice(+b.dataset.del, 1); saveOwn(); renderOwn(); };

// ---------- Einstellungen ----------
function syncStart() {
  $('oTotal').value = S.total; $('oFeel').value = S.feel; $('oLet').value = S.let; $('oVoice').value = S.voice; $('oAnn').value = S.announce ? '1' : '0'; $('oMode').value = S.mode;
  const parts = [];
  parts.push(S.key ? 'Gemini verbunden' : 'Ohne Gemini (Standardsätze)');
  if (S.voice === 'pocket') parts.push(engine ? 'KI-Stimme geladen' : 'KI-Stimme lädt beim Start');
  if (dir) parts.push(dirOk ? `Ordner „${dir.name}“` : 'Ordner: Zugriff wird beim Start bestätigt');
  $('startStatus').textContent = parts.join(' · ');
}
function openSettings() {
  $('sKey').value = S.key; $('sModel').value = S.model; $('sPerson').value = FORM[S.person] ? S.person : 'mix';
  $('refText').textContent = REF_TEXT; renderOwn(); renderVoices(); renderAllMusic(); checkTracks(); show('settings');
  if (!dir) dirMsg('Kein Ordner verbunden. Ohne Ordner speichert die App alles intern.');
  else if (!dirOk) dirMsg(`Ordner „${dir.name}“ gemerkt, Zugriff muss bestätigt werden: tippe auf „Neu einlesen“.`);
}
$('toSet').onclick = openSettings;
$('setBack').onclick = () => { stopMusic(800); CATS.forEach(k => card(k).querySelector('.mtest').textContent = 'Probehören'); S.key = $('sKey').value.trim(); S.model = $('sModel').value.trim() || DEFAULT_MODEL; S.person = $('sPerson').value; saveS(); syncStart(); show('start'); };
$('sKey').onchange = () => { S.key = $('sKey').value.trim(); saveS(); };
$('sModel').onchange = () => { S.model = $('sModel').value.trim() || DEFAULT_MODEL; saveS(); };
$('sPerson').onchange = () => { S.person = $('sPerson').value; saveS(); };
function renderVoices() {
  buildVoices();
  $('voiceList').innerHTML = VOICES.map(v => `<span class="chip">${esc(v.name)} <span class="small">${v.src === 'folder' ? 'Ordner' : v.src === 'app' ? 'App' : 'eingebaut'}</span><span style="width:8px"></span></span>`).join('');
  document.querySelectorAll('.vsel').forEach(sel => {
    const role = sel.dataset.role;
    sel.innerHTML = (role === 'base' ? '' : '<option value="base">wie Grundstimme</option>') + VOICES.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');
    const cur = S.roles[role] || 'base';
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : (role === 'base' ? 'juergen' : 'base');
  });
}
document.querySelectorAll('.vsel').forEach(sel => sel.onchange = () => {
  S.roles[sel.dataset.role] = sel.value; saveS();
  $('sPrepOut').textContent = sel.dataset.role === 'base' ? 'Grundstimme geändert. Tippe auf „Ansagen vorbereiten“, damit Ansagen und Anker in dieser Stimme erzeugt werden.' : 'Gespeichert. Die Sätze werden ab der nächsten Runde in dieser Stimme erzeugt.';
});
$('sTest').onclick = async () => {
  S.key = $('sKey').value.trim(); S.model = $('sModel').value.trim() || DEFAULT_MODEL; saveS();
  $('sTestOut').textContent = 'Teste …';
  try { const o = await gemini('Druck', null); $('sTestOut').textContent = 'Funktioniert. Beispiel: ' + o.sentences[0]; }
  catch (e) { $('sTestOut').textContent = 'Fehler: ' + (e.message || e); }
};
const STAGE = { model: 'Modell', assets: 'Stimmen', encoder: 'Stimm-Encoder', prompts: 'Ansagen' };
$('sPrep').onclick = async () => {
  audioCtx(); const b = $('sPrep'); b.disabled = true;
  try {
    await prepareAll((stage, p) => {
      const f = p && p.total ? p.loaded / p.total : 0;
      $('sBar').style.width = Math.round(f * 100) + '%';
      $('sPrepOut').textContent = `${STAGE[stage] || stage}: ${p && p.total ? (stage === 'prompts' ? `${p.loaded}/${p.total}` : Math.round(f * 100) + ' %') : '…'}`;
    });
    $('sBar').style.width = '100%';
    $('sPrepOut').textContent = `Fertig. Grundstimme: ${(VOICES.find(v => v.id === roleVoice('base')) || {}).name}. Alles liegt im Speicher der App.`;
  } catch (e) { $('sPrepOut').textContent = 'Fehler: ' + (e.message || e); }
  b.disabled = false;
};
$('sTry').onclick = async () => {
  audioCtx(); $('sPrepOut').textContent = 'Erzeuge Probe …';
  try { await ensureFolder(); const a = await synth('Da ist Druck in meiner Brust. Ich lasse ihn ganz da sein.', roleVoice('base')); playSamples(a); $('sPrepOut').textContent = 'Probe läuft.'; }
  catch (e) { $('sPrepOut').textContent = 'Fehler: ' + (e.message || e); }
};
// Stimme klonen
let cloneBuf = null, cloneTimer = null;
$('cRec').onclick = async () => {
  audioCtx();
  if (rec) {
    clearInterval(cloneTimer);
    const r = await recStop().catch(() => null);
    $('cRec').textContent = 'Nochmal aufnehmen';
    if (!r || r.seconds < 5) { $('cOut').textContent = 'Zu kurz. Bitte den ganzen Text lesen.'; return; }
    cloneBuf = r.buffer; $('cPlay').disabled = $('cUse').disabled = false;
    $('cOut').textContent = `${Math.round(r.seconds)} s aufgenommen. Hör kurz rein, dann übernehmen.`;
    return;
  }
  try { await recStart(); } catch (e) { $('cOut').textContent = 'Mikrofon nicht erlaubt.'; return; }
  $('cRec').textContent = 'Aufnahme stoppen';
  cloneTimer = setInterval(() => { if (!rec) return clearInterval(cloneTimer); $('cOut').textContent = `Aufnahme ${fmt(Date.now() - rec.t0)}`; if (Date.now() - rec.t0 > 25000) $('cRec').click(); }, 300);
};
$('cPlay').onclick = async () => { if (cloneBuf) playSamples({ s: await toMono(cloneBuf, 24000, 25), r: 24000 }); };
$('cUse').onclick = async () => {
  if (!cloneBuf) return;
  const name = $('cName').value.trim() || 'Meine Stimme ' + new Date().toLocaleDateString('de-DE');
  $('cUse').disabled = true; $('cOut').textContent = 'Speichere Stimme …';
  try {
    const samples = await toMono(cloneBuf, 24000, 20);
    let id;
    if (dir && await ensureFolder()) {
      const sd = await sub('stimmen'); let file = slug(name) + '.wav', n = 2;
      const existing = new Set((await listAudio(sd)).map(f => f.name));
      while (existing.has(file)) file = `${slug(name)}-${n++}.wav`;
      await writeFile(sd, file, new Blob([wavBytes(samples, 24000)], { type: 'audio/wav' }));
      const meta = await readJSON(sd, 'stimmen.json', { stimmen: [] });
      (meta.stimmen = Array.isArray(meta.stimmen) ? meta.stimmen : []).push({ name, datei: file });
      await writeFile(sd, 'stimmen.json', JSON.stringify(meta, null, 2));
      await scanFolder(); buildVoices(); id = (VOICES.find(v => v.file === file) || {}).id;
      $('cOut').textContent = `„${name}“ gespeichert in stimmen/${file}.`;
    } else {
      await idb.set('refVoice', samples); S.cloneId = Date.now(); saveS(); buildVoices(); id = 'app:' + S.cloneId;
      sampleCache.delete(id);
      $('cOut').textContent = 'Gespeichert in der App (ohne Ordner ist Platz für eine Stimme).';
    }
    if (id && roleVoice('base') === 'juergen') S.roles.base = id;
    saveS(); renderVoices();
    $('cOut').textContent += ' Wähle oben, für welche Rolle sie gilt, und tippe dann auf „Ansagen vorbereiten“.';
  } catch (e) { $('cOut').textContent = 'Fehler: ' + (e.message || e); }
  $('cUse').disabled = false;
};

// ---------- Ereignisse ----------
$('bStart').onclick = begin;
$('bFeelSkip').onclick = toChoose;
$('grid').onclick = e => { const b = e.target.closest('[data-f]'); if (b) pick(b.dataset.f); };
$('ownF').onsubmit = e => { e.preventDefault(); pick($('own').value); };
$('bBack').onclick = backToFeeling;
$('bAnchor').onclick = anchor;
$('bLove').onclick = () => toggleMusic('liebe');
$('bWut').onclick = () => toggleMusic('wut');
$('bNext').onclick = nextQuestion;
$('bLetDone').onclick = () => { cur.gone = true; toCheck(); };
$('bMore').onclick = () => { cur.r++; cur.gone = false; toLet(); };
$('bAgain').onclick = toFeel;
document.querySelectorAll('[data-stop]').forEach(b => b.onclick = finish);
$('bRestart').onclick = () => { syncStart(); show('start'); };

syncStart();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
