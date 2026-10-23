// =====================================================================
//  MOTORI DI TRASCRIZIONE
//  Ogni motore riceve l'URI dell'audio e restituisce il testo finale.
//  `onStatus` aggiorna il messaggio mostrato durante l'attesa.
// =====================================================================
import { NativeModules, NativeEventEmitter } from 'react-native';
import axios from 'axios';

export type Engine = 'groq' | 'gemini' | 'local';
type OnStatus = (message: string) => void;

export const ENGINE_LABELS: Record<Engine, { name: string; tag: string }> = {
  groq: { name: 'Groq', tag: 'Whisper + LLM' },
  gemini: { name: 'Gemini', tag: 'Transcribe 3.5' },
  local: { name: 'Locale', tag: 'Parakeet Ultra' },
};

export const DEFAULTS = {
  whisperModel: 'whisper-large-v3',
  // llama-3.3-70b-versatile e stato dismesso da Groq il 16/08/2026.
  llamaModel: 'openai/gpt-oss-120b',
  apiKey: 'INSERISCI_QUI_LA_TUA_CHIAVE_GROQ',
  geminiModel: 'gemini-3.5-transcribe',
};

// Moduli nativi locali (android/app/src/main/java/com/audioscribe/glass).
export const Native = NativeModules.AudioScribeNative;
export const LocalAsr = NativeModules.LocalAsr;
export const localAsrEvents = LocalAsr ? new NativeEventEmitter(LocalAsr) : null;

export const normalizeUri = (uri: string) =>
  uri.startsWith('file://') || uri.startsWith('content://') ? uri : 'file://' + uri;

export const errorMessage = (error: any) => {
  const apiError = error?.response?.data?.error;
  if (apiError) return typeof apiError === 'string' ? apiError : apiError.message || JSON.stringify(apiError);
  return error?.message || 'Errore sconosciuto';
};

// ---------------------------------------------------------------------
//  Groq: Whisper trascrive, poi un LLM aggiunge punteggiatura e paragrafi
// ---------------------------------------------------------------------
export const transcribeWithGroq = async (
  uri: string, opts: { key: string; whisperModel: string; llamaModel: string }, onStatus: OnStatus,
) => {
  onStatus('Trascrizione con Whisper…');
  const formData = new FormData();
  formData.append('file', { uri: normalizeUri(uri), type: 'audio/ogg', name: 'audio.ogg' } as any);
  formData.append('model', opts.whisperModel);
  formData.append('prompt', 'Testo in italiano.');

  const transRes = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
    headers: { Authorization: `Bearer ${opts.key}`, 'Content-Type': 'multipart/form-data' },
  });
  const rawText: string = transRes.data.text;
  if (rawText.length < 10) return rawText;

  onStatus('Formattazione del testo…');
  const chatRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: opts.llamaModel,
    messages: [
      { role: 'system', content: 'Formatta il seguente testo parlato: aggiungi punteggiatura, maiuscole e dividi in paragrafi. Non cambiare le parole.' },
      { role: 'user', content: rawText },
    ],
  }, {
    headers: { Authorization: `Bearer ${opts.key}`, 'Content-Type': 'application/json' },
  });
  return chatRes.data.choices[0].message.content as string;
};

// ---------------------------------------------------------------------
//  Gemini 3.5 Transcribe: trascrive e formatta in una sola chiamata
// ---------------------------------------------------------------------
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const GEMINI_MIME_TYPES = ['audio/wav', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac'];

// WhatsApp puo dichiarare tipi non standard (audio/opus, octet-stream...):
// li normalizziamo su un tipo che Gemini accetta.
export const toGeminiMime = (declared?: string, uri?: string) => {
  const raw = (declared || '').split(';')[0].trim().toLowerCase();
  if (GEMINI_MIME_TYPES.includes(raw)) return raw;
  const aliases: Record<string, string> = {
    'audio/mpeg': 'audio/mp3',
    'audio/opus': 'audio/ogg',
    'audio/vorbis': 'audio/ogg',
    'audio/x-wav': 'audio/wav',
    'audio/wave': 'audio/wav',
    'audio/mp4': 'audio/aac',
    'audio/m4a': 'audio/aac',
    'audio/x-m4a': 'audio/aac',
  };
  if (aliases[raw]) return aliases[raw];

  const ext = (uri || '').split('?')[0].split('.').pop()?.toLowerCase() || '';
  const byExt: Record<string, string> = {
    ogg: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mp3', wav: 'audio/wav',
    flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/aac', aiff: 'audio/aiff',
  };
  // I vocali WhatsApp sono ogg/opus: default sensato.
  return byExt[ext] || 'audio/ogg';
};

// La risposta di /v1beta/interactions espone il testo in steps[].content[].
// Restiamo tolleranti su piu forme per non rompere se l'API evolve.
export const extractGeminiText = (data: any): string => {
  if (!data) return '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const fromSteps = (data.steps || [])
    .flatMap((s: any) => s?.content || [])
    .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
  if (fromSteps) return fromSteps;

  return (data.candidates || [])
    .flatMap((c: any) => c?.content?.parts || [])
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
};

export type GeminiOpts = { key: string; model: string; smart: boolean; lang: string; vocab: string };

export const transcribeWithGemini = async (
  uri: string, sharedMime: string | undefined, opts: GeminiOpts, onStatus: OnStatus,
) => {
  if (!opts.key) throw new Error('Manca la API key di Gemini: aggiungila nelle Impostazioni.');
  onStatus('Lettura dell\'audio…');
  const cleanUri = normalizeUri(uri);
  const base64 = await Native.readAsBase64(cleanUri);

  // Stesse opzioni di AI Studio. "smart" applica pulizia delle esitazioni,
  // correzione grammaticale e formattazione; non e combinabile con
  // timestamp o diarizzazione, che qui non servono.
  const transcriptionConfig: any = {
    language_codes: opts.lang === 'auto' ? [] : [opts.lang],
    mode: opts.smart ? 'smart' : { type: 'verbatim' },
  };
  const vocabList = opts.vocab.split(/[,\n]/).map(s => s.trim()).filter(Boolean).slice(0, 1000);
  if (vocabList.length) transcriptionConfig.custom_vocabulary = vocabList;

  onStatus('Trascrizione con Gemini…');
  const res = await axios.post(
    GEMINI_ENDPOINT,
    {
      model: opts.model,
      input: [{ type: 'audio', data: base64, mime_type: toGeminiMime(sharedMime, cleanUri) }],
      generation_config: { transcription_config: transcriptionConfig },
    },
    { headers: { 'x-goog-api-key': opts.key, 'Content-Type': 'application/json' } },
  );
  const text = extractGeminiText(res.data);
  if (!text) throw new Error('Gemini non ha restituito testo.');
  return text;
};

// ---------------------------------------------------------------------
//  Locale: Parakeet Ultra sul dispositivo, nessuna rete
// ---------------------------------------------------------------------
export const transcribeLocally = async (uri: string, onStatus: OnStatus) => {
  if (!LocalAsr) throw new Error('Trascrizione locale non disponibile su questo dispositivo.');
  const sub = localAsrEvents?.addListener('LocalAsrProgress', e => onStatus(e.message));
  try {
    return (await LocalAsr.transcribe(normalizeUri(uri))) as string;
  } finally {
    sub?.remove();
  }
};
