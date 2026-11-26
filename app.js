// Loslassen — Meditations-PWA nach David R. Hawkins' "Letting Go"
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Inhalte ----------
const FEEL = ['Druck', 'Enge', 'Unruhe', 'Angst', 'Gehetzt', 'Gedanken', 'Ärger', 'Schwere', 'Traurig', 'Weiß nicht'];
const PROMPTS = ['Lass es ganz da sein.', 'Du musst nichts daran ändern.', 'Spür die Energie dahinter, nicht die Gedanken.', 'Wo im Körper sitzt es?', 'Lass auch den Widerstand da sein.', 'Darf es gehen?', 'Nur dieses Gefühl. Nichts sonst.'];
const SAY = { feel: 'Spür rein. Was ist gerade da?', choose: 'Was willst du loslassen?', check: 'Wie ist es jetzt?', end: 'Die Zeit ist um.' };
const FIXED = [...Object.values(SAY), ...PROMPTS];
const REF_TEXT = 'Ich sitze ruhig da und spüre, was gerade in mir ist. Da ist ein leichter Druck in der Brust, vielleicht auch etwas Enge im Bauch. Ich muss nichts daran ändern. Ich lasse es einfach da sein, so wie es ist, und atme weiter. Gedanken kommen und gehen, und ich bleibe bei dem Gefühl.';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

// ---------- Speicher ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const S = Object.assign({ total: 20, feel: 30, let: 120, voice: 'pocket', pv: 'juergen', key: '', model: DEFAULT_MODEL, person: 'ich', cloneId: 0 }, LS.get('ll-set', {}));
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
  return { get: k => run('readonly', s => s.get(k)).catch(() => undefined), set: (k, v) => run('readwrite', s => s.put(v, k)).catch(() => {}) };
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
function wavBase64(s, rate) {
  const n = s.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s[i])) * 32767, true);
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------- Pocket TTS ----------
let engine = null, enginePromise = null, refSamples = null, cloneReady = false;
let ttsChain = Promise.resolve();
const promptCache = new Map();
const voiceKey = () => S.pv === 'cloned' && S.cloneId ? 'cloned-' + S.cloneId : 'juergen';

function getEngine(onProgress) {
  if (engine) return Promise.resolve(engine);
  if (!enginePromise) {
    enginePromise = (async () => {
      const m = await import('./vendor/pocket-tts.js');
      const e = await m.Engine.load({
        language: 'german',
        ortWasmUrl: new URL('./vendor/ort/', location.href).href,
        worker: () => new Worker(new URL('./vendor/pocket-tts-worker.js', location.href), { type: 'module' }),
        onProgress: (stage, p) => onProgress && onProgress(stage, p)
      });
      engine = e;
      await applyVoice(onProgress);
      return e;
    })().catch(err => { enginePromise = null; throw err; });
  }
  return enginePromise;
}
async function applyVoice(onProgress) {
  cloneReady = false;
  if (S.pv !== 'cloned' || !engine) return;
  refSamples = refSamples || await idb.get('refVoice');
  if (refSamples) { await engine.clone(refSamples, onProgress); cloneReady = true; }
}
function synth(text) {
  const job = ttsChain.then(async () => {
    const e = await getEngine();
    const voice = S.pv === 'cloned' && cloneReady && refSamples ? refSamples : e.defaultVoice;
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
  const k = voiceKey();
  for (const t of FIXED) {
    if (promptCache.has(k + '|' + t)) continue;
    const a = await idb.get('p|' + k + '|' + t);
    if (a) promptCache.set(k + '|' + t, a);
  }
}
async function prepareAll(onStep) {
  await getEngine(onStep);
  await loadPromptCache();
  const k = voiceKey(); let i = 0;
  for (const t of FIXED) {
    i++;
    if (!promptCache.has(k + '|' + t)) {
      const a = await synth(t);
      promptCache.set(k + '|' + t, a); await idb.set('p|' + k + '|' + t, a);
    }
    onStep && onStep('prompts', { loaded: i, total: FIXED.length });
  }
}
// Text ausgeben: vorbereitete Datei > KI-Stimme live > Browser-Stimme
function say(text) {
  if (S.voice === 'off') return;
  if (S.voice === 'pocket') {
    const a = promptCache.get(voiceKey() + '|' + text);
    if (a) return playSamples(a);
    if (engine) return void synth(text).then(a => { if (state !== 'start') playSamples(a); }).catch(() => browserSpeak(text));
  }
  browserSpeak(text);
}

// ---------- Gemini ----------
function fallbackSentences(f, person) {
  const ich = person !== 'du';
  const w = f && f !== '…' ? f : (ich ? 'dieses Gefühl' : 'dieses Gefühl');
  return ich
    ? [`Da ist ${w}. Ich spüre es jetzt.`, 'Ich spüre, wo es im Körper sitzt.', 'Ich lasse es genau so da sein, wie es ist.', 'Ich muss nichts daran ändern.']
    : [`Da ist ${w}. Spür es jetzt.`, 'Spür, wo es im Körper sitzt.', 'Lass es genau so da sein, wie es ist.', 'Du musst nichts daran ändern.'];
}
async function gemini(feeling, audioB64) {
  const ich = S.person !== 'du';
  const prompt = `Du unterstützt eine Meditation nach David R. Hawkins ("Letting Go"). Ich lasse gerade ein Gefühl los.
Benanntes Gefühl/Zustand: "${feeling === '…' ? 'noch nicht benannt' : feeling}".
${audioB64 ? 'Im Audio spreche ich aus, was ich gerade loslassen will und welche Gedanken dazu kommen.' : 'Es gibt keine Aufnahme.'}

Aufgaben:
1. ${audioB64 ? 'Transkribiere das Audio wörtlich auf Deutsch in "transcript".' : 'Setze "transcript" auf einen leeren String.'}
2. Benenne das Gefühl in "label" mit ein bis drei Wörtern.
3. Schreibe 3 bis 5 kurze Sätze in "sentences". Sie werden mir vorgelesen, wenn ich während des Loslassens dissoziiere, also mich nicht mehr spüre oder mich in Gedanken verliere. Sie sollen mich zurück IN dieses Gefühl bringen, damit ich es ganz da sein lassen kann.

Regeln für die Sätze:
- ${ich ? 'Ich-Form ("Ich spüre …", "Da ist …")' : 'Du-Form ("Du spürst …", "Da ist …")'}, Präsens, höchstens 12 Wörter, schlicht und ruhig.
- Satz 1 greift den konkreten Auslöser auf (Situation, Gedanke, meine eigenen Worte aus dem Audio), damit das Gefühl wieder spürbar wird.
- Die weiteren Sätze führen weg von den Gedanken hin zur Körperempfindung (wo, wie: Druck, Enge, Hitze, Ziehen …) und zum Da-sein-lassen.
- Keine Ratschläge, keine Lösungen, kein Trost, keine Beruhigung, kein "entspann dich", keine Bewertung, keine Warum-Fragen.
- Nicht dramatisieren und nichts erfinden, was nicht im Audio oder im Gefühl steckt.`;
  const parts = [{ text: prompt }];
  if (audioB64) parts.push({ inline_data: { mime_type: 'audio/wav', data: audioB64 } });
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.6, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { transcript: { type: 'STRING' }, label: { type: 'STRING' }, sentences: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['label', 'sentences'] }
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
  out.sentences = (out.sentences || []).map(s => String(s).trim()).filter(Boolean).slice(0, 5);
  if (!out.sentences.length) throw new Error('keine Sätze erhalten');
  return out;
}

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

function begin() {
  S.total = +$('oTotal').value; S.feel = +$('oFeel').value; S.let = +$('oLet').value; S.voice = $('oVoice').value; saveS();
  audioCtx(); lock();
  log = []; sessionStart = Date.now(); sessionEnd = sessionStart + S.total * 60000;
  if (S.voice === 'pocket') { loadPromptCache(); getEngine().catch(() => {}); }
  gong(); setTimeout(toFeel, 60);
}
function toFeel() { if (over()) return finish(); show('feel'); phase(S.feel); say(SAY.feel); }
function toChoose() { if (over()) return finish(); show('choose'); renderGrid(); setRecBtn(); gong(true); say(SAY.choose); }

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
  cur = { t: new Date().toISOString(), f, r: 1, gone: false, hadAudio: !!audio, transcript: '', sentences: fallbackSentences(f, S.person), source: 'standard', audio: [], idx: 0 };
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
      if (entry.f === '…' && out.label) { entry.f = out.label; if (cur === entry && state === 'let') $('letWord').textContent = entry.f; }
    } catch (e) { entry.source = 'standard'; entry.error = String(e.message || e); }
  }
  setBackInfo();
  if (S.voice === 'pocket') {
    const list = entry.sentences;
    for (let i = 0; i < list.length; i++) {
      try { const a = await synth(list[i]); if (entry.sentences === list) entry.audio[i] = a; } catch (e) { break; }
      setBackInfo();
    }
  }
}
function setBackInfo() {
  if (!cur) return;
  const n = cur.sentences.length, ready = cur.audio.filter(Boolean).length;
  let t = cur.source === 'gemini' ? `${n} Sätze aus deiner Aufnahme` : (S.key ? (cur.error ? 'Gemini-Fehler, Standardsätze' : 'Sätze werden erstellt …') : `${n} Standardsätze`);
  if (S.voice === 'pocket' && ready < n) t += ` · Stimme ${ready}/${n}`;
  $('backInfo').textContent = t;
}
function backToFeeling() {
  if (!cur) return;
  const i = cur.idx % cur.sentences.length; cur.idx++;
  const text = cur.sentences[i];
  $('said').textContent = text;
  nextPrompt = Date.now() + 30000;      // Impulse nicht gleich darüber legen
  if (S.voice === 'off') return;
  if (S.voice === 'pocket' && cur.audio[i]) return playSamples(cur.audio[i]);
  if (S.voice === 'pocket' && engine) return void synth(text).then(a => { cur.audio[i] = cur.audio[i] || a; playSamples(a); }).catch(() => browserSpeak(text));
  browserSpeak(text);
}

function toLet() {
  show('let'); $('letWord').textContent = cur.f; $('said').textContent = '';
  phase(S.let); pi = 0; nextPrompt = Date.now() + 24000;
  $('letPrompt').textContent = PROMPTS[0]; say(PROMPTS[0]); setBackInfo();
}
function toCheck() {
  if (over()) return finish();
  show('check');
  $('moreLbl').textContent = `nochmal ${S.let >= 120 ? S.let / 60 + ' Min' : S.let + ' Sek'} mit „${cur.f}“`;
  gong(); say(SAY.check);
}
function finish() {
  if (state === 'end') return;
  clearInterval(recTimer); if (rec) recStop().catch(() => {});
  show('end'); gong(); say(SAY.end);
  try { wake && wake.release(); } catch (e) {}
  const mins = Math.round((Date.now() - sessionStart) / 60000);
  $('sum').textContent = log.length ? `${mins} Min · ${log.length} Gefühle · ${log.reduce((a, b) => a + b.r, 0)} Runden Loslassen` : `${mins} Min · nichts notiert`;
  $('log').innerHTML = log.map(l => `<div class="row"><span class="t">${esc(hm(l.t))}</span><span class="fw">${esc(l.f)}</span><span class="n">${l.r}×${l.gone ? ' gegangen' : ''}</span>${l.transcript ? `<p class="d">„${esc(l.transcript)}“</p>` : ''}${l.source === 'gemini' ? `<p class="d">${l.sentences.map(esc).join(' · ')}</p>` : ''}</div>`).join('') || '<p class="small">Keine Einträge.</p>';
  const sessions = LS.get('ll-log', []);
  sessions.push({ start: new Date(sessionStart).toISOString(), minutes: mins, entries: log.map(({ audio, idx, ...rest }) => rest) });
  LS.set('ll-log', sessions.slice(-200));
}

setInterval(() => {
  if (['start', 'end', 'settings'].includes(state)) return;
  const now = Date.now(), rem = sessionEnd - now;
  const txt = rem > 0 ? `noch ${Math.ceil(rem / 60000)} Min` : 'Zeit ist um';
  document.querySelectorAll('.rest').forEach(e => e.textContent = txt);
  if (state === 'feel') { $('tF').textContent = fmt(phaseEnd - now); ring('rF', now); if (now >= phaseEnd) toChoose(); }
  else if (state === 'let') {
    $('tL').textContent = fmt(phaseEnd - now); ring('rL', now);
    if (now >= nextPrompt && phaseEnd - now > 8000) {
      pi = (pi + 1) % PROMPTS.length; const p = $('letPrompt'); p.style.opacity = 0;
      setTimeout(() => { p.textContent = PROMPTS[pi]; p.style.opacity = 1; }, 500);
      say(PROMPTS[pi]); nextPrompt = now + 26000;
    }
    if (now >= phaseEnd) toCheck();
  } else if (state === 'choose' && rem <= 0 && !rec) finish();
}, 250);

// ---------- Export / Import ----------
function exportJSON() {
  const data = { app: 'loslassen', version: 2, exported: new Date().toISOString(), ownFeelings: OWN, sessions: LS.get('ll-log', []) };
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
    saveOwn(); renderOwn(); $('xOut').textContent = `${added} Gefühle importiert.`;
  } catch (err) { $('xOut').textContent = 'Datei konnte nicht gelesen werden.'; }
  e.target.value = '';
};
function renderOwn() {
  $('ownList').innerHTML = OWN.length ? OWN.map((o, i) => `<span class="chip">${esc(o.name)}<button data-del="${i}" aria-label="${esc(o.name)} löschen">×</button></span>`).join('') : '<p class="small">Noch keine eigenen Einträge. Alles, was du selbst eintippst, landet hier.</p>';
}
$('ownList').onclick = e => { const b = e.target.closest('[data-del]'); if (!b) return; OWN.splice(+b.dataset.del, 1); saveOwn(); renderOwn(); };

// ---------- Einstellungen ----------
function syncStart() {
  $('oTotal').value = S.total; $('oFeel').value = S.feel; $('oLet').value = S.let; $('oVoice').value = S.voice;
  const parts = [];
  parts.push(S.key ? 'Gemini verbunden' : 'Ohne Gemini (Standardsätze)');
  if (S.voice === 'pocket') parts.push(engine ? 'KI-Stimme geladen' : 'KI-Stimme lädt beim Start');
  $('startStatus').textContent = parts.join(' · ');
}
function openSettings() {
  $('sKey').value = S.key; $('sModel').value = S.model; $('sPerson').value = S.person; $('sPV').value = S.pv;
  $('refText').textContent = REF_TEXT; renderOwn(); show('settings');
}
$('toSet').onclick = openSettings;
$('setBack').onclick = () => { S.key = $('sKey').value.trim(); S.model = $('sModel').value.trim() || DEFAULT_MODEL; S.person = $('sPerson').value; saveS(); syncStart(); show('start'); };
$('sKey').onchange = () => { S.key = $('sKey').value.trim(); saveS(); };
$('sModel').onchange = () => { S.model = $('sModel').value.trim() || DEFAULT_MODEL; saveS(); };
$('sPerson').onchange = () => { S.person = $('sPerson').value; saveS(); };
$('sPV').onchange = async () => {
  S.pv = $('sPV').value; saveS();
  if (S.pv === 'cloned' && !S.cloneId) $('sPrepOut').textContent = 'Nimm unten erst deine Stimme auf.';
  if (engine) { await applyVoice().catch(() => {}); $('sPrepOut').textContent = 'Stimme gewechselt. Tippe auf „Ansagen vorbereiten“.'; }
};
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
    $('sPrepOut').textContent = `Fertig. Stimme: ${S.pv === 'cloned' && cloneReady ? 'deine eigene' : 'Jürgen'}. Alles liegt im Speicher der App.`;
  } catch (e) { $('sPrepOut').textContent = 'Fehler: ' + (e.message || e); }
  b.disabled = false;
};
$('sTry').onclick = async () => {
  audioCtx(); $('sPrepOut').textContent = 'Erzeuge Probe …';
  try { const a = await synth('Da ist Druck in meiner Brust. Ich lasse ihn ganz da sein.'); playSamples(a); $('sPrepOut').textContent = 'Probe läuft.'; }
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
  $('cUse').disabled = true; $('cOut').textContent = 'Speichere Stimme …';
  const rate = engine ? engine.sampleRate : 24000;
  refSamples = await toMono(cloneBuf, rate, 20);
  await idb.set('refVoice', refSamples);
  S.cloneId = Date.now(); S.pv = 'cloned'; saveS(); $('sPV').value = 'cloned';
  if (engine) { try { await applyVoice(); } catch (e) {} }
  $('cOut').textContent = 'Gespeichert. Tippe oben auf „Modell laden und Ansagen vorbereiten“, damit alle Ansagen in deiner Stimme erzeugt werden.';
  $('cUse').disabled = false;
};

// ---------- Ereignisse ----------
$('bStart').onclick = begin;
$('bFeelSkip').onclick = toChoose;
$('grid').onclick = e => { const b = e.target.closest('[data-f]'); if (b) pick(b.dataset.f); };
$('ownF').onsubmit = e => { e.preventDefault(); pick($('own').value); };
$('bBack').onclick = backToFeeling;
$('bLetDone').onclick = () => { cur.gone = true; toCheck(); };
$('bMore').onclick = () => { cur.r++; cur.gone = false; toLet(); };
$('bAgain').onclick = toFeel;
document.querySelectorAll('[data-stop]').forEach(b => b.onclick = finish);
$('bRestart').onclick = () => { syncStart(); show('start'); };

syncStart();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
