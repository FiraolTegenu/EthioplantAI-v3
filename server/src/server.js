import './loadEnv.js';
import path from 'path';
import { fileURLToPath } from 'url';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

const app = express();
const port = Number(process.env.PORT) || 3000;
const clientOrigin = process.env.CLIENT_ORIGIN || `http://localhost:${port}`;

app.use(
  cors({
    origin: clientOrigin,
    methods: ['GET', 'POST'],
  })
);

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/upload', uploadRouter);
app.use('/api/disease-upload', diseaseUploadRouter);
app.use('/api/images', imagesRouter);
app.use('/api/identification', identificationRouter);
app.use('/api/disease', diseaseRouter);
app.use('/api/files', filesRouter);
app.use('/api/chat', chatRouter);

// Pretty URL for disease results: /disease-result/:id → disease-result.html?id=
app.get('/disease-result/:documentId', (req, res) => {
  const id = encodeURIComponent(req.params.documentId);
  res.redirect(302, `/disease-result.html?id=${id}`);
});

// Unknown API paths must return JSON (never the SPA HTML shell)
app.use('/api', (_req, res) => {
  res.status(404).json({
    success: false,
    error: 'API route not found.',
    data: [],
  });
});

app.use(express.static(projectRoot));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ success: false, error: 'API route not found.', data: [] });
    return;
  }
  if (req.path.endsWith('.html')) {
    const pagePath = path.join(projectRoot, path.basename(req.path));
    res.sendFile(pagePath, (err) => {
      if (err) next(err);
    });
    return;
  }
  res.sendFile(path.join(projectRoot, 'index.html'));
});

app.listen(port, async () => {
  try {
    assertAppwriteConfig();
    console.log('Appwrite configuration loaded from server/.env');
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
      'Disease detection: APPWRITE_DISEASE_COLLECTION_ID not set — create disease_detections in Appwrite (see server/src/schemas/disease-detections.collection.json)'
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
        console.error('[chat] Fix: set a valid GROQ_API_KEY in server/.env');
      }
    }
  } else {
    console.warn(
      'AI Farming Assistant: no API key — set GROQ_API_KEY in server/.env (chat returns 503)'
    );
  }

  console.log(`Server running at http://localhost:${port}`);
  console.log(`Serving static files from ${projectRoot}`);
});
