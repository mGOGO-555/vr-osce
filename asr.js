// 学生の声の認識（Quest内で処理。声は外部に送らず、保存もしない）
// Whisper（transformers.js、CDN）で認識し、症例JSONの質問項目の `say`（キーワード）に当てはめる。
const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
const MODEL = 'onnx-community/whisper-tiny';
export const asr = { status: 'idle', note: '', onChange: () => {} };
let pipe = null, stream = null, rec = null, chunks = [];
const set = (status, note = '') => { asr.status = status; asr.note = note; try { asr.onChange(); } catch (e) { /* noop */ } };

// ID確定のクリック（ユーザー操作）の中で呼ぶ：マイク許可 → モデル読み込み（初回のみ数十MBをダウンロード）
export async function prepare() {
  if (asr.status === 'loading' || asr.status === 'ready') return;
  if (!navigator.mediaDevices || !window.MediaRecorder) { set('error', 'マイク非対応'); return; }
  set('loading', '準備中');
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { set('error', 'マイク不許可'); return; }
  try {
    const { pipeline } = await import(CDN);
    pipe = await pipeline('automatic-speech-recognition', MODEL, {
      device: 'wasm', dtype: 'q8',
      progress_callback: (p) => { if (p.status === 'progress') set('loading', `準備中 ${Math.round(p.progress || 0)}%`); },
    });
    set('ready');
  } catch (e) { set('error', '認識モデルを読み込めません'); }
}

export function startRecording() {
  if (window.__asrStub) return true;   // PC動作確認用
  if (asr.status !== 'ready' || rec) return false;
  chunks = []; rec = new MediaRecorder(stream); rec.ondataavailable = (e) => chunks.push(e.data); rec.start(); return true;
}
export function cancelRecording() { if (rec) { rec.onstop = null; try { rec.stop(); } catch (e) { /* noop */ } rec = null; chunks = []; } }

async function toFloat16k(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const ab = await ctx.decodeAudioData(await blob.arrayBuffer()); ctx.close();
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(ab.duration * 16000)), 16000);
  const src = off.createBufferSource(); src.buffer = ab; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}
// 録音を止めて認識 → 文字列（失敗時は ''）
export function stopAndRecognize() {
  if (window.__asrStub) return Promise.resolve(window.__asrStub);
  return new Promise((resolve) => {
    if (!rec) { resolve(''); return; }
    const r = rec; rec = null;
    r.onstop = async () => {
      try {
        const audio = await toFloat16k(new Blob(chunks, { type: r.mimeType }));
        const res = await pipe(audio, { language: 'japanese', task: 'transcribe' });
        resolve((res.text || '').trim());
      } catch (e) { resolve(''); }
      chunks = [];
    };
    r.stop();
  });
}

// 認識した文を質問項目に当てはめる：①項目の say（キーワード）が文中にあれば、長く一致した項目を選ぶ
// ②なければ、項目の文面との文字の重なり（2文字ずつ）が大きい項目を選ぶ。全角半角・カタカナ／ひらがなの違いは無視する
const norm = (s) => s.normalize('NFKC').replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s、。，．,.！？!?「」『』・]/g, '').toLowerCase();
const bigrams = (t) => { const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
export function matchItem(text, items) {
  const t = norm(text || ''); if (!t) return null;
  let best = null, bestScore = 0;
  for (const it of items) {
    let sc = 0;
    for (const k of it.say || []) if (t.includes(norm(k))) sc += norm(k).length;
    if (sc > bestScore) { best = it; bestScore = sc; }
  }
  if (best) return best;
  const tg = bigrams(t); let bf = null, bfs = 0;
  for (const it of items) {
    const lg = bigrams(norm(it.label)); if (!lg.size) continue;
    let hit = 0; for (const g of lg) if (tg.has(g)) hit++;
    const r = hit / lg.size; if (r > bfs) { bf = it; bfs = r; }
  }
  return bfs >= 0.3 ? bf : null;
}
