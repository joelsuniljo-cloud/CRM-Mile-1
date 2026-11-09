// Thin proxy to the Anthropic API. The prompts are written by the front end;
// this file adds the key, the model, and tolerant JSON parsing.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
let client = null;

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

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
  throw new AiError(502, 'invalid_json', 'Claude replied in a shape that could not be read as JSON.');
}

export async function askJson(prompt) {
  if (!aiConfigured()) throw new AiError(503, 'not_configured', 'ANTHROPIC_API_KEY is not set on the server.');
  client ||= new Anthropic();
  let msg;
  try {
    msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: 'You reply with a single JSON value and nothing else. The reply is parsed by a program.',
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    const status = e?.status;
    if (status === 429) throw new AiError(429, 'rate_limited', 'Too many requests to Claude. Try again shortly.');
    if (status === 401 || status === 403) throw new AiError(503, 'sampling_disabled', 'The Anthropic API key was rejected.');
    if (status === 404) throw new AiError(503, 'sampling_disabled', `Model "${MODEL}" was not found. Set ANTHROPIC_MODEL.`);
    throw new AiError(502, 'upstream_error', 'The Claude API request failed.');
  }
  if (msg.stop_reason === 'max_tokens') throw new AiError(502, 'invalid_json', 'The reply was cut short.');
  const text = msg.content.filter((p) => p.type === 'text').map((p) => p.text).join('');
  if (!text.trim()) throw new AiError(502, 'empty_completion', 'Claude returned nothing.');
  return parseLoose(text);
}
