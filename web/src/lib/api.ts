export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T = unknown>(path: string, opts: { method?: Method; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Pas de connexion au serveur');
  }
  if (!res.ok) {
    let msg = 'Une erreur est survenue';
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* réponse non JSON */
    }
    throw new ApiError(res.status, msg);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Envoi de fichier avec suivi de progression (0–1). */
export function upload<T>(path: string, file: Blob, filename = 'fichier', onProgress?: (p: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T);
      else reject(new ApiError(xhr.status, (xhr.response as { error?: string } | null)?.error ?? 'Envoi impossible'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Pas de connexion au serveur'));
    const fd = new FormData();
    fd.append('file', file, filename);
    xhr.send(fd);
  });
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Une erreur est survenue');
