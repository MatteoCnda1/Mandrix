import type { ZodTypeAny, z } from 'zod';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const res = schema.safeParse(data ?? {});
  if (!res.success) {
    const issue = res.error.issues[0];
    throw new HttpError(400, issue?.message ?? 'Requête invalide');
  }
  return res.data;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function uuidParam(params: unknown, key = 'id'): string {
  const v = (params as Record<string, string>)[key];
  if (!v || !isUuid(v)) fail(404, 'Introuvable');
  return v;
}
