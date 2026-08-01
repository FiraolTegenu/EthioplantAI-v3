import net from 'node:net';
import geoip from 'geoip-lite';

const ALLOWED_COUNTRY = 'ET';

const RESTRICTION_ENABLED =
  String(process.env.COUNTRY_RESTRICTION ?? 'true').toLowerCase() !== 'false';

const DEBUG = process.env.DEBUG_COUNTRY === '1' || process.env.NODE_ENV === 'development';

const SKIP_PATHS = new Set(['/health', '/chat/health']);

const DENY_MESSAGE = 'This service is only available in Ethiopia.';
const UNKNOWN_LOCATION_MESSAGE = 'Could not determine the request location.';

function debugLog(info) {
  if (!DEBUG) return;
  console.log(
    '[country-filter]',
    JSON.stringify({
      ip: info.ip ?? null,
      country: info.country ?? null,
      path: info.path ?? null,
      decision: info.decision,
    })
  );
}

function deny(res, message) {
  return res.status(403).json({ success: false, error: message, code: 'COUNTRY_RESTRICTED' });
}

export function normalizeIp(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (net.isIP(value) === 4) return value;
  if (net.isIP(value) === 6) {
    const ipv4Mapped = value.toLowerCase();
    if (ipv4Mapped.startsWith('::ffff:')) {
      const tail = ipv4Mapped.slice('::ffff:'.length);
      if (net.isIP(tail) === 4) return tail;
    }
    return value;
  }
  return null;
}

export function isValidIp(value) {
  return net.isIP(value) !== 0;
}

export function isPrivateOrLoopback(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;

  if (net.isIP(normalized) === 6) {
    const lower = normalized.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    const segments = lower.split(':');
    const first = parseInt(segments[0] || '0', 16);
    if (!Number.isNaN(first) && (first & 0xfe00) === 0xfc00) return true;
    if (!Number.isNaN(first) && (first & 0xffc0) === 0xfe80) return true;
    return false;
  }

  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const candidate = normalizeIp(xff.split(',')[0]);
    if (candidate) return candidate;
  }

  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.trim()) {
    const candidate = normalizeIp(xRealIp);
    if (candidate) return candidate;
  }

  const requestIp = normalizeIp(req.ip);
  if (requestIp) return requestIp;

  const remote = normalizeIp(req.socket?.remoteAddress);
  if (remote) return remote;

  return null;
}

export function resolveCountry(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized) return null;
  const geo = geoip.lookup(normalized);
  return geo?.country || null;
}

export function ethiopiaOnly(req, res, next) {
  if (!RESTRICTION_ENABLED) {
    debugLog({ decision: 'skip', path: req.path });
    return next();
  }

  if (req.method === 'OPTIONS') {
    debugLog({ decision: 'skip', path: req.path });
    return next();
  }

  if (SKIP_PATHS.has(req.path)) {
    debugLog({ decision: 'skip', path: req.path });
    return next();
  }

  const ip = getClientIp(req);
  if (!ip) {
    debugLog({ decision: 'blocked', path: req.path });
    return deny(res, UNKNOWN_LOCATION_MESSAGE);
  }

  if (isPrivateOrLoopback(ip)) {
    debugLog({ ip, decision: 'allowed', path: req.path });
    return next();
  }

  const country = resolveCountry(ip);
  if (country === ALLOWED_COUNTRY) {
    debugLog({ ip, country, decision: 'allowed', path: req.path });
    return next();
  }

  debugLog({ ip, country, decision: 'blocked', path: req.path });
  return deny(res, DENY_MESSAGE);
}

export default ethiopiaOnly;
