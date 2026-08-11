import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const envPath = path.join(frontendRoot, '.env');
const configPath = path.join(frontendRoot, 'public', 'js', 'config.js');

/**
 * Minimal .env loader (no external dependency).
 * Reads a .env file and populates process.env ONLY for keys that are not
 * already set. Real environment variables (e.g. Vercel build env or a CI
 * variable) always take precedence over .env files, matching dotenv.
 */
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// Load .env.production first so it wins over .env (matches Vite mode semantics),
// while real env vars still take precedence over both files.
loadDotEnv(path.join(frontendRoot, '.env.production'));
loadDotEnv(envPath);

const apiBase = (process.env.VITE_API_URL || '').replace(/\/$/, '');
const debug = process.env.VITE_DEBUG === 'true';

const content = `/** Auto-generated — do not edit. Set VITE_API_URL in .env */\nwindow.__APP_CONFIG__ = {\n  apiBase: ${JSON.stringify(apiBase)},\n  debug: ${debug},\n};\n`;

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, content, 'utf8');

console.log(`[config] Wrote ${configPath} (apiBase: ${apiBase || '(same origin via dev proxy)'})`);
