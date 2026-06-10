import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'server', '.env'),
];

let envLoadedFrom = null;

for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error && result.parsed && Object.keys(result.parsed).length > 0) {
    envLoadedFrom = envPath;
    if (process.env.APPWRITE_PROJECT_ID?.trim()) {
      break;
    }
  }
}

if (envLoadedFrom) {
  const groqSet = Boolean(process.env.GROQ_API_KEY?.trim());
  console.log('[env] Loaded', envLoadedFrom, {
    GROQ_API_KEY: groqSet ? 'set' : 'missing',
    AI_MODEL: process.env.AI_MODEL?.trim() || process.env.GROQ_MODEL?.trim() || '(default)',
  });
} else {
  console.warn('[env] No .env file loaded — check server/.env exists');
}
