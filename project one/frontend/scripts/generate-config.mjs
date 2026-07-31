import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const envPath = path.join(frontendRoot, '.env');
const configPath = path.join(frontendRoot, 'public', 'js', 'config.js');

/**
 * Minimal .env loader (no external dependency).
 * Reads frontend/.env and populates process.env ONLY for keys that are not
 * already set. Real environment variables (e.g. Netlify build.environment or
 * a CI variable) always take precedence over the .env file, matching the
 * behaviour of dotenv.
 */
function loadDotEnv() {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
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

loadDotEnv();

const apiBase = (process.env.VITE_API_URL || '').replace(/\/$/, '');
const debug = process.env.VITE_DEBUG === 'true';

const content = `/** Auto-generated — do not edit. Set VITE_API_URL in .env */\nwindow.__APP_CONFIG__ = {\n  apiBase: ${JSON.stringify(apiBase)},\n  debug: ${debug},\n};\n`;

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, content, 'utf8');

console.log(`[config] Wrote ${configPath} (apiBase: ${apiBase || '(same origin via dev proxy)'})`);
