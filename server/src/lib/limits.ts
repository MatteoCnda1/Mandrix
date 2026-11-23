import type { FastifyRequest, RouteShorthandOptions } from 'fastify';
import { env } from '../env.js';

/**
 * Limite anti-spam par compte (adresse IP sans session) : `max` envois par minute.
 * Désactivée en test (sauf test dédié) et avec SPAM_LIMITS=0.
 */
export function perMinute(max: number): RouteShorthandOptions {
  if (!env.spamLimits) return {};
  return {
    config: {
      rateLimit: {
        max,
        timeWindow: '1 minute',
        keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip,
        errorResponseBuilder: (_req: FastifyRequest, ctx: { ttl: number }) => {
          const err = new Error(`Doucement ! Trop d’envois d’affilée, réessaie dans ${Math.max(1, Math.ceil(ctx.ttl / 1000))} s.`) as Error & { statusCode: number };
          err.statusCode = 429;
          return err;
        },
      },
    },
  };
}
