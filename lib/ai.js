// Thin proxy to the Gemini API (REST, no SDK needed). The prompts are written by the front end;
// this file adds the key and model and parses the reply as JSON.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const aiConfigured = () => Boolean(process.env.GEMINI_API_KEY);

export class AiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function parseLoose(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* fall through */ } }
  const a = t.search(/[{[]/);
  const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  throw new AiError(502, 'invalid_json', 'The reply could not be read as JSON.');
}

export async function askJson(prompt) {
  if (!aiConfigured()) throw new AiError(503, 'not_configured', 'GEMINI_API_KEY is not set on the server.');
  let res;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'You reply with a single JSON value and nothing else. The reply is parsed by a program.' }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // Thinking tokens count toward the output limit, so leave generous room.
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192, temperature: 0.7 },
      }),
    });
  } catch {
    throw new AiError(502, 'upstream_error', 'Could not reach the Gemini API.');
  }
  if (!res.ok) {
    const s = res.status;
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* no body */ }
    console.error('Gemini error', s, detail);
    if (s === 429) throw new AiError(429, 'rate_limited', 'Gemini rate limit reached. Try again shortly.');
    if (s === 401 || s === 403 || /API key/i.test(detail)) throw new AiError(503, 'sampling_disabled', 'The Gemini API key was rejected.');
    if (s === 404) throw new AiError(503, 'sampling_disabled', `Model "${MODEL}" was not found. Set GEMINI_MODEL.`);
    throw new AiError(502, 'upstream_error', 'The Gemini request failed.');
  }
  const body = await res.json();
  const cand = body?.candidates?.[0];
  if (!cand) throw new AiError(502, 'refused', body?.promptFeedback?.blockReason ? 'Gemini blocked that input.' : 'Gemini returned nothing.');
  if (cand.finishReason === 'MAX_TOKENS') throw new AiError(502, 'invalid_json', 'The reply was cut short.');
  const text = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!text.trim()) throw new AiError(502, 'empty_completion', 'Gemini returned nothing.');
  return parseLoose(text);
}
