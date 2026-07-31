import { Router } from 'express';
import { assertAppwriteConfig } from '../config/appwrite.js';

const router = Router();

function maskSecret(value) {
  const v = String(value ?? '');
  if (!v) return '';
  if (v.length <= 8) return '*'.repeat(v.length);
  return `${v.slice(0, 4)}…${v.slice(-4)} (len ${v.length})`;
}

router.get('/appwrite', async (_req, res) => {
  const names = [
    'APPWRITE_ENDPOINT',
    'APPWRITE_PROJECT_ID',
    'APPWRITE_API_KEY',
    'APPWRITE_BUCKET_ID',
    'APPWRITE_DATABASE_ID',
    'APPWRITE_COLLECTION_ID',
    'APPWRITE_DISEASE_COLLECTION_ID',
  ];

  const envReport = Object.fromEntries(
    names.map((name) => {
      const value = process.env[name] ?? '';
      const isSecret = name.includes('KEY');
      const report = {
        present: value.length > 0,
        length: value.length,
      };
      if (!isSecret) report.json = JSON.stringify(value);
      if (isSecret) report.masked = maskSecret(value);
      return [name, report];
    })
  );

  let urlCheck = null;
  let fetchReport = null;

  try {
    assertAppwriteConfig();
    const endpoint = process.env.APPWRITE_ENDPOINT.trim();

    try {
      new URL(endpoint);
      urlCheck = { ok: true };
    } catch (err) {
      urlCheck = { ok: false, error: err.message };
    }

    const target = `${endpoint.replace(/\/$/, '')}/databases`;
    try {
      const response = await fetch(target, {
        headers: {
          'X-Appwrite-Project': (process.env.APPWRITE_PROJECT_ID ?? '').trim(),
          'X-Appwrite-Key': (process.env.APPWRITE_API_KEY ?? '').trim(),
        },
        signal: AbortSignal.timeout(15000),
      });
      fetchReport = {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        bodyStart: (await response.text()).slice(0, 200),
      };
    } catch (err) {
      fetchReport = {
        ok: false,
        errorName: err?.name ?? null,
        errorMessage: err?.message ?? null,
        causeCode: err?.cause?.code ?? null,
        causeMessage: err?.cause?.message ?? null,
      };
    }
  } catch (err) {
    urlCheck = { error: err.message };
  }

  res.json({
    env: envReport,
    urlCheck,
    fetchReport,
  });
});

export default router;
