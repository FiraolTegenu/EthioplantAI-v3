import { Router } from 'express';
import { getPlantDocumentById } from '../config/appwrite.js';
import { identificationFromDocument } from '../services/plantnet.js';
import {
  generateFarmingAssistantReply,
  buildPlantContextFromRecord,
  getAiEnvDiagnostics,
  probeGroqApi,
} from '../services/aiChat.js';

const router = Router();
const DEBUG = process.env.DEBUG_CHAT === '1' || process.env.NODE_ENV === 'development';

function mergeContext(clientContext = {}, serverContext = {}) {
  const plant = { ...(serverContext.plant || {}), ...(clientContext.plant || {}) };
  const disease = { ...(serverContext.disease || {}), ...(clientContext.disease || {}) };

  const out = {};
  if (Object.keys(plant).some((k) => plant[k])) out.plant = plant;
  if (Object.keys(disease).some((k) => disease[k])) out.disease = disease;
  return out;
}

function statusForCode(code) {
  if (code === 'not_configured') return 503;
  if (code === 'empty_message' || code === 'message_too_long') return 400;
  if (code === 'auth_failed' || code === 'rate_limit' || code === 'ai_error') return 502;
  if (code === 'network_error') return 502;
  return 502;
}

/**
 * GET /api/chat/health
 */
router.get('/health', async (_req, res) => {
  const diag = getAiEnvDiagnostics();
  let probe = { ok: false, providerReachable: false, error: 'Key not loaded' };

  if (diag.groqKeyLoaded) {
    probe = await probeGroqApi();
  }

  res.json({
    serverRunning: true,
    groqKeyLoaded: diag.groqKeyLoaded,
    modelConfigured: diag.modelConfigured,
    apiConfigured: diag.apiConfigured,
    providerReachable: probe.providerReachable ?? probe.ok ?? false,
    model: diag.model,
    keySource: diag.keySource,
    keyMask: diag.keyMask,
    probeHttpStatus: probe.httpStatus ?? null,
    probeDurationMs: probe.durationMs ?? null,
    probeError: probe.error || null,
  });
});

router.post('/', async (req, res) => {
  const requestStarted = Date.now();
  const diag = getAiEnvDiagnostics();

  console.log('[chat] POST /api/chat — request received');
  console.log('[chat] Environment:', {
    groqKeyLoaded: diag.groqKeyLoaded,
    keySource: diag.keySource,
    keyMask: diag.keyMask,
    model: diag.model,
    apiBase: diag.apiBase,
    GROQ_API_KEY_set: diag.groqApiKeySet,
  });

  if (DEBUG) {
    console.log('[chat] Request body:', JSON.stringify({
      message: req.body?.message?.slice?.(0, 200),
      historyLength: Array.isArray(req.body?.history) ? req.body.history.length : 0,
      context: req.body?.context,
      document_id: req.body?.document_id,
    }));
  }

  if (!diag.groqKeyLoaded) {
    const backendError =
      '503 root cause: isAiChatConfigured() returned false — GROQ_API_KEY is not set in backend/.env';
    console.error('[chat]', backendError);
    res.status(503).json({
      success: false,
      error: 'The farming assistant is not available right now. Please try again later.',
      code: 'not_configured',
    });
    return;
  }

  const { message, history, context, document_id: documentId } = req.body || {};

  if (!message || !String(message).trim()) {
    res.status(400).json({
      success: false,
      error: 'Please enter a message.',
      code: 'empty_message',
    });
    return;
  }

  let serverContext = {};
  if (documentId && typeof documentId === 'string') {
    try {
      const record = await getPlantDocumentById(documentId.trim());
      if (record) {
        const identification = identificationFromDocument(record);
        serverContext = buildPlantContextFromRecord(record, identification);
        console.log('[chat] Loaded Appwrite context for document:', documentId.trim());
      }
    } catch (err) {
      console.warn('[chat] Could not load plant record for context:', err?.message, err?.stack);
    }
  }

  const mergedContext = mergeContext(context, serverContext);
  console.log('[chat] Merged context:', JSON.stringify(mergedContext));

  const result = await generateFarmingAssistantReply({
    message,
    history: Array.isArray(history) ? history.slice(-20) : [],
    context: mergedContext,
  });

  const totalMs = Date.now() - requestStarted;

  if (!result.ok) {
    console.error('[chat] Request failed:', {
      code: result.code,
      httpStatus: result.httpStatus,
      backendError: result.debug,
      totalMs,
      failingStep:
        result.code === 'not_configured'
          ? 'chat.js isAiChatConfigured() guard'
          : result.code === 'auth_failed'
            ? 'aiChat.js Groq auth'
            : result.code === 'network_error'
              ? 'aiChat.js fetch()'
              : 'aiChat.js Groq chat/completions',
    });

    res.status(statusForCode(result.code)).json({
      success: false,
      error: result.error,
      code: result.code,
      reachedServer: true,
      reachedGroq: result.code !== 'not_configured' && result.code !== 'network_error',
    });
    return;
  }

  console.log('[chat] Request succeeded', { totalMs, groqMs: result.durationMs });
  res.json({
    success: true,
    data: {
      reply: result.reply,
    },
  });
});

export default router;
