import { retroYear, type RetroState } from '@mandrix/shared';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { retroFor } from '../lib/retro.js';

const parisYear = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric' }).format(new Date()));

/** Rétro de l'année : la mienne seulement. Par défaut, l'année proposée sur le fil (ou l'année en cours). */
export default async function retroRoutes(app: FastifyInstance) {
  app.get('/api/retro', async (req): Promise<RetroState> => {
    const me = requireUser(req);
    const current = parisYear();
    const asked = Number((req.query as { year?: string }).year);
    const year = Number.isInteger(asked) && asked >= 2024 && asked <= current ? asked : (retroYear() ?? current);
    return retroFor(me.id, year);
  });
}
