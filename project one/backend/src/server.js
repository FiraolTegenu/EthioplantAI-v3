import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import uploadRouter from './routes/upload.js';
import diseaseUploadRouter from './routes/disease-upload.js';
import imagesRouter from './routes/images.js';
import identificationRouter from './routes/identification.js';
import diseaseRouter from './routes/disease.js';
import filesRouter from './routes/files.js';
import chatRouter from './routes/chat.js';
import { assertAppwriteConfig } from './config/appwrite.js';
import { getAiEnvDiagnostics, probeGroqApi } from './services/aiChat.js';

const app = express();
const port = Number(process.env.PORT) || 3000;

function parseAllowedOrigins() {
  const raw = process.env.CLIENT_ORIGIN?.trim();
  if (raw) {
    return raw
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return [`http://localhost:5173`, `http://localhost:${port}`];
}

const allowedOrigins = parseAllowedOrigins();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
  })
);

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ethioplantai-api' });
});

app.use('/api/upload', uploadRouter);
app.use('/api/disease-upload', diseaseUploadRouter);
app.use('/api/images', imagesRouter);
app.use('/api/identification', identificationRouter);
app.use('/api/disease', diseaseRouter);
app.use('/api/files', filesRouter);
app.use('/api/chat', chatRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({
    success: false,
    error: 'API route not found.',
    data: [],
  });
});

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'API route not found.',
    data: [],
  });
});

app.use((err, _req, res, next) => {
  if (err && /^CORS blocked origin: /.test(String(err?.message || ''))) {
    res.status(403).json({ success: false, error: String(err.message) });
    return;
  }
  next(err);
});

app.listen(port, async () => {
  try {
    assertAppwriteConfig();
    console.log('Appwrite configuration loaded');
  } catch (err) {
    console.warn(`Warning: ${err.message}`);
  }

  const plantNetKey = process.env.PLANTNET_API_KEY?.trim();
  const plantNetProject = process.env.PLANTNET_PROJECT?.trim() || 'all';
  const plantNetBase =
    process.env.PLANTNET_API_BASE?.trim() || 'https://my-api.plantnet.org/v2';
  if (plantNetKey) {
    console.log(
      `PlantNet configured: ${plantNetBase}/identify/${plantNetProject} (key …${plantNetKey.slice(-4)})`
    );
  } else {
    console.warn('PlantNet: PLANTNET_API_KEY not set — identification will be skipped');
  }

  const diseaseCollectionId = process.env.APPWRITE_DISEASE_COLLECTION_ID?.trim();
  if (diseaseCollectionId) {
    console.log(`Disease detection collection: ${diseaseCollectionId}`);
  } else {
    console.warn(
      'Disease detection: APPWRITE_DISEASE_COLLECTION_ID not set — create disease_detections in Appwrite (see backend/src/schemas/disease-detections.collection.json)'
    );
  }

  const aiDiag = getAiEnvDiagnostics();
  if (aiDiag.groqKeyLoaded) {
    console.log('[chat] Startup env validation:', {
      keySource: aiDiag.keySource,
      keyMask: aiDiag.keyMask,
      keyFormat: aiDiag.keyFormat,
      keyLength: aiDiag.keyLength,
      model: aiDiag.model,
      apiBase: aiDiag.apiBase,
      keyHadWhitespace: aiDiag.keyHadWhitespace,
    });

    const probe = await probeGroqApi();
    if (probe.ok) {
      console.log(`[chat] Startup Groq probe OK (${probe.durationMs}ms, HTTP ${probe.httpStatus})`);
    } else {
      console.error('[chat] Startup Groq probe FAILED:', {
        code: probe.code,
        error: probe.error,
        groqMessage: probe.groqMessage,
        httpStatus: probe.httpStatus,
        durationMs: probe.durationMs,
      });
      if (probe.code === 'auth_failed') {
        console.error('[chat] Fix: set a valid GROQ_API_KEY in backend/.env');
      }
    }
  } else {
    console.warn(
      'AI Farming Assistant: no API key — set GROQ_API_KEY in backend/.env (chat returns 503)'
    );
  }

  console.log(`API server listening on port ${port}`);
  console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
});
