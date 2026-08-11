/**
 * Groq farming assistant (API key server-side only).
 */

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_API_BASE = 'https://api.groq.com/openai/v1/chat/completions';
const DEBUG = process.env.DEBUG_CHAT === '1' || process.env.NODE_ENV === 'development';

function chatLog(...args) {
  console.log('[chat]', ...args);
}

function chatError(...args) {
  console.error('[chat]', ...args);
}

function maskKey(key = '') {
  const k = String(key).trim();
  if (!k) return '(missing)';
  if (k.length <= 8) return '****';
  const prefix = k.startsWith('gsk_') ? 'gsk_…' : '…';
  return `${prefix}${k.slice(-4)} (len ${k.length})`;
}

/** Strip quotes, BOM, and stray whitespace from .env values. */
export function sanitizeApiKey(raw = '') {
  let key = String(raw).trim();
  key = key.replace(/^\uFEFF/, '');
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key.replace(/\s+/g, '');
}

function resolveApiKey() {
  return sanitizeApiKey(process.env.GROQ_API_KEY || '');
}

function resolveModel() {
  return (
    process.env.AI_MODEL?.trim() ||
    process.env.GROQ_MODEL?.trim() ||
    DEFAULT_MODEL
  );
}

function isInvalidKeyGroqError(json = {}, message = '', httpStatus) {
  const errType = json?.error?.type || json?.error?.code;
  return (
    errType === 'invalid_api_key' ||
    /invalid api key|incorrect api key|authentication/i.test(message) ||
    httpStatus === 401 ||
    httpStatus === 403
  );
}

function classifyGroqHttpError(json = {}, message = '', httpStatus) {
  if (isInvalidKeyGroqError(json, message, httpStatus)) return 'auth_failed';
  if (httpStatus === 429 || /rate limit|quota|too many requests/i.test(message)) return 'rate_limit';
  return 'ai_error';
}

function userMessageForGroqFailure(code) {
  if (code === 'auth_failed') {
    return 'Invalid Groq API key. Check GROQ_API_KEY in server/.env';
  }
  if (code === 'not_configured') {
    return 'The farming assistant is not configured. Set GROQ_API_KEY in server/.env';
  }
  if (code === 'rate_limit') {
    return 'Groq API rate limit reached. Please wait a moment and try again.';
  }
  if (code === 'network_error') {
    return 'Could not reach the Groq API. Check your internet connection and try again.';
  }
  return 'The farming assistant is temporarily unavailable. Please try again in a moment.';
}

function getAiConfig() {
  const apiKey = resolveApiKey();
  const model = resolveModel();
  const apiBase = (process.env.AI_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/$/, '');
  return { apiKey, model, apiBase, keySource: apiKey ? 'GROQ_API_KEY' : null };
}

export function getAiEnvDiagnostics() {
  const { apiKey, model, apiBase, keySource } = getAiConfig();
  const rawGroq = process.env.GROQ_API_KEY || '';
  return {
    groqKeyLoaded: Boolean(apiKey),
    apiConfigured: Boolean(apiKey),
    modelConfigured: Boolean(model),
    model,
    apiBase,
    keySource,
    keyMask: maskKey(apiKey),
    keyLength: apiKey.length,
    keyFormat: apiKey.startsWith('gsk_') ? 'gsk (Groq)' : apiKey ? 'unknown' : 'none',
    groqApiKeySet: Boolean(sanitizeApiKey(rawGroq)),
    keyHadWhitespace: rawGroq !== sanitizeApiKey(rawGroq),
  };
}

export function isAiChatConfigured() {
  return getAiEnvDiagnostics().groqKeyLoaded;
}

function buildContextBlock(context = {}) {
  const lines = [];

  const plant = context.plant || {};
  if (plant.scientific_name) lines.push(`Scientific name: ${plant.scientific_name}`);
  if (plant.common_name) lines.push(`Common name: ${plant.common_name}`);
  if (plant.family) lines.push(`Family: ${plant.family}`);
  if (plant.genus) lines.push(`Genus: ${plant.genus}`);
  if (plant.confidence_percent != null) {
    lines.push(`Identification confidence: ${plant.confidence_percent}%`);
  } else if (plant.confidence_score != null) {
    lines.push(`Identification confidence: ${Math.round(Number(plant.confidence_score) * 1000) / 10}%`);
  }
  if (plant.location) lines.push(`Location: ${plant.location}`);

  const disease = context.disease || {};
  if (disease.name || disease.detected_disease) {
    lines.push(`Detected disease: ${disease.name || disease.detected_disease}`);
  }
  if (disease.severity) lines.push(`Severity: ${disease.severity}`);
  if (disease.treatment || disease.treatment_information) {
    lines.push(`Treatment information: ${disease.treatment || disease.treatment_information}`);
  }

  if (!lines.length) return '';
  return `\n\nCurrent plant context (use when relevant):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

function buildSystemPrompt(context) {
  return `You are an AI Farming Assistant for Ethiopian farmers and gardeners using the Ethionative Plant Database app.

Your role: provide practical, safe, and readable agricultural guidance about plant diseases, crop management, fertilizers, irrigation, pests, soil, harvest timing, and general plant care.

Response format rules (always follow):
- Use clear section headings ending with a colon on their own line, e.g. "Diagnosis:", "Recommended Actions:", "Prevention:"
- Use bullet points (• or -) for lists of symptoms, causes, or tips.
- Use numbered steps (1. 2. 3.) for procedures and action plans.
- Keep paragraphs short (2–4 sentences max).
- Separate sections with blank lines.
- Prioritize readability and actionable farming advice.
- If plant context is provided, reference it in your answer.
- If information is uncertain, say so and suggest safe next steps.
- Do not mention API keys, internal IDs, or technical system details.
- Do not provide medical advice for humans; focus on plants and crops.${buildContextBlock(context)}`;
}

function toGroqMessages(history = [], userMessage, systemPrompt) {
  const messages = [{ role: 'system', content: systemPrompt }];

  for (const entry of history) {
    const text = String(entry.content || entry.message || '').trim();
    if (!text) continue;
    const role = entry.role === 'assistant' ? 'assistant' : 'user';
    messages.push({ role, content: text });
  }

  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || last.content !== userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  return messages;
}

function buildGroqPayload(model, messages) {
  return {
    model,
    messages,
    temperature: 0.65,
    max_tokens: 2048,
  };
}

function parseGroqReply(json) {
  return String(json?.choices?.[0]?.message?.content || '').trim();
}

async function callGroqApi({ apiKey, model, apiBase, messages, label = 'request' }) {
  const url = apiBase;
  const payload = buildGroqPayload(model, messages);
  const started = Date.now();

  chatLog(`Groq ${label}:`, {
    url,
    model,
    messageCount: messages.length,
    authHeader: 'Authorization: Bearer',
    keyMask: maskKey(apiKey),
  });

  if (DEBUG) {
    chatLog(`Groq ${label} payload preview:`, JSON.stringify({
      ...payload,
      messages: payload.messages.map((m) => ({
        role: m.role,
        content: m.role === 'system' ? `[${m.content.length} chars]` : m.content.slice(0, 120),
      })),
    }));
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const durationMs = Date.now() - started;
  const rawText = await response.text();
  let json = {};
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch (parseErr) {
    json = { parseError: true };
    chatError(`Groq ${label} JSON parse failed:`, parseErr?.message);
  }

  chatLog(`Groq ${label} response:`, {
    httpStatus: response.status,
    durationMs,
    bodyPreview: rawText.slice(0, 400),
  });

  return { response, json, rawText, durationMs };
}

/**
 * Lightweight probe for GET /api/chat/health
 */
export async function probeGroqApi() {
  const diag = getAiEnvDiagnostics();
  if (!diag.groqKeyLoaded) {
    return {
      ok: false,
      providerReachable: false,
      httpStatus: null,
      durationMs: 0,
      error: 'No API key loaded (set GROQ_API_KEY in server/.env)',
      code: 'not_configured',
    };
  }

  const { apiKey, model, apiBase } = getAiConfig();
  const started = Date.now();

  try {
    const { response, json, rawText, durationMs } = await callGroqApi({
      apiKey,
      model,
      apiBase,
      messages: [
        { role: 'system', content: 'Reply with exactly: OK' },
        { role: 'user', content: 'ping' },
      ],
      label: 'health probe',
    });

    if (!response.ok) {
      const groqMessage =
        json?.error?.message || json?.message || rawText.slice(0, 500) || `HTTP ${response.status}`;
      const code = classifyGroqHttpError(json, groqMessage, response.status);
      chatError('Health probe failed:', { code, groqMessage, httpStatus: response.status });
      return {
        ok: false,
        providerReachable: false,
        httpStatus: response.status,
        durationMs,
        error: userMessageForGroqFailure(code),
        code,
        groqMessage,
        responseBody: DEBUG ? rawText.slice(0, 500) : undefined,
      };
    }

    return {
      ok: true,
      providerReachable: true,
      httpStatus: response.status,
      durationMs: durationMs || Date.now() - started,
      error: null,
      code: 'ok',
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    chatError('Health probe network error:', err?.message, err?.stack);
    return {
      ok: false,
      providerReachable: false,
      httpStatus: null,
      durationMs,
      error: err?.message || 'Network error',
      code: 'network_error',
      stack: DEBUG ? err?.stack : undefined,
    };
  }
}

/**
 * @param {{ message: string, history?: Array, context?: object }} params
 */
export async function generateFarmingAssistantReply({ message, history = [], context = {} }) {
  const diag = getAiEnvDiagnostics();
  const { apiKey, model, apiBase } = getAiConfig();

  chatLog('Env diagnostics:', {
    groqKeyLoaded: diag.groqKeyLoaded,
    keySource: diag.keySource,
    keyMask: diag.keyMask,
    model: diag.model,
    apiBase: diag.apiBase,
    groqApiKeySet: diag.groqApiKeySet,
  });

  if (!apiKey) {
    chatError('Failing step: getAiConfig() — no API key. Set GROQ_API_KEY in server/.env');
    return {
      ok: false,
      error: userMessageForGroqFailure('not_configured'),
      code: 'not_configured',
      debug: 'Missing GROQ_API_KEY',
    };
  }

  const trimmed = String(message || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Please enter a message.', code: 'empty_message' };
  }

  if (trimmed.length > 4000) {
    return { ok: false, error: 'Message is too long. Please shorten your question.', code: 'message_too_long' };
  }

  const systemPrompt = buildSystemPrompt(context);
  const messages = toGroqMessages(history, trimmed, systemPrompt);

  chatLog('Incoming user message:', trimmed.slice(0, 200));
  chatLog('Context data:', JSON.stringify(context));

  try {
    const { response, json, rawText, durationMs } = await callGroqApi({
      apiKey,
      model,
      apiBase,
      messages,
      label: 'chat request',
    });

    if (!response.ok) {
      const groqMessage = json?.error?.message || json?.message || rawText.slice(0, 500);
      const groqStatus = json?.error?.type || json?.error?.code;
      const code = classifyGroqHttpError(json, groqMessage, response.status);
      chatError('Failing step: Groq chat/completions — HTTP error', {
        httpStatus: response.status,
        groqStatus,
        groqMessage,
        code,
        durationMs,
        responseBody: rawText.slice(0, 1000),
        stack: json?.error,
      });
      return {
        ok: false,
        error: userMessageForGroqFailure(code),
        code,
        debug: groqMessage,
        httpStatus: response.status,
      };
    }

    const reply = parseGroqReply(json);

    if (!reply) {
      chatError('Failing step: empty reply from Groq', {
        choices: json?.choices,
        durationMs,
      });
      return {
        ok: false,
        error: 'No response was generated. Please try rephrasing your question.',
        code: 'empty_reply',
        debug: 'Groq returned 200 but no text in choices[0].message.content',
      };
    }

    chatLog('Groq success', { durationMs, replyChars: reply.length });
    return { ok: true, reply, durationMs };
  } catch (err) {
    chatError('Failing step: fetch() to Groq — network/exception', {
      message: err?.message,
      stack: err?.stack,
    });
    return {
      ok: false,
      error: userMessageForGroqFailure('network_error'),
      code: 'network_error',
      debug: err?.message,
    };
  }
}

export function buildPlantContextFromRecord(record, identification = null) {
  if (!record) return {};

  const id = identification || {};
  let commonNames = [];
  try {
    if (Array.isArray(record.common_names)) commonNames = record.common_names;
    else if (record.common_names) commonNames = JSON.parse(record.common_names);
  } catch {
    commonNames = record.common_name ? [record.common_name] : [];
  }

  const score = record.confidence_score ?? id.confidence_score;
  const confidencePercent =
    score != null && !Number.isNaN(Number(score)) ? Math.round(Number(score) * 1000) / 10 : null;

  return {
    plant: {
      scientific_name: record.scientific_name || id.scientific_name || '',
      common_name: commonNames[0] || record.common_name || id.common_name || record.plant_title || '',
      family: record.family || id.family || '',
      genus: record.genus || id.genus || '',
      confidence_score: score,
      confidence_percent: id.confidence_percent ?? confidencePercent,
      location: record.location || '',
    },
  };
}
