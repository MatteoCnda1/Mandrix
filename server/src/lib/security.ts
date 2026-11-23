import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';

/** Empreintes SHA-256 des scripts en ligne de la page (le thème appliqué avant le premier affichage). */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    out.push(`'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
  return out;
}

/** Politique de contenu de la PWA : tout vient du site lui-même, sauf les images et sons locaux (data:, blob:). */
export function contentSecurityPolicy(hashes: string[]): string {
  const ws = env.appUrl.replace(/^http/, 'ws');
  return [
    "default-src 'self'",
    ["script-src 'self'", ...hashes].join(' '),
    // Attributs style de React et animations calculées.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${ws}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** En-têtes de sécurité sur toutes les réponses, et la CSP sur les pages HTML. */
export function securityHeaders(app: FastifyInstance, webDist: string | null) {
  const index = webDist ? path.join(webDist, 'index.html') : null;
  const html = index && fs.existsSync(index) ? fs.readFileSync(index, 'utf8') : '';
  const csp = contentSecurityPolicy(inlineScriptHashes(html));
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()');
    if (env.isProd) reply.header('Strict-Transport-Security', 'max-age=15552000');
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) reply.header('Content-Security-Policy', csp);
    return payload;
  });
}
