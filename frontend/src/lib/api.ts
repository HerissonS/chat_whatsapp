/**
 * Cliente da API. Usa caminhos relativos ("api/..."), então funciona na raiz ou em subcaminho.
 * O token CSRF vem de /api/auth/me e é enviado em toda requisição que altera dados.
 */
let csrfToken = '';

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly fields?: Array<{ field: string; message: string }>,
  ) {
    super(message);
  }
}

function errorMessage(body: unknown, status: number): { message: string; code?: string; fields?: ApiError['fields'] } {
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; code?: string; fields?: ApiError['fields'] };
    const msg = Array.isArray(b.message) ? b.message.join('; ') : typeof b.message === 'string' ? b.message : undefined;
    if (b.fields?.length) {
      return { message: `${msg ?? 'Dados inválidos'}: ${b.fields.map((f) => `${f.field} ${f.message}`).join('; ')}`, code: b.code, fields: b.fields };
    }
    if (msg) return { message: msg, code: b.code };
  }
  if (status === 0) return { message: 'Sem conexão com o servidor.' };
  if (status >= 500) return { message: 'Erro no servidor. Tente novamente.' };
  return { message: `Erro ${status}` };
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`api/${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor.', 0);
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const e = errorMessage(data, res.status);
    if (res.status === 401 && !path.startsWith('auth/login')) window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(e.message, res.status, e.code, e.fields);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form, true),
};

/** Monta query string ignorando valores vazios. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
