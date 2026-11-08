/**
 * Ollama destination. A URL entered in Settings takes precedence; an empty one
 * falls back to the server's OLLAMA_BASE_URL.
 */
export const MAX_OLLAMA_URL_LENGTH = 2048;

export function resolveOllamaBase(
  clientUrl: string | undefined,
  envUrl = process.env.OLLAMA_BASE_URL
): { base: string | undefined; fromClient: boolean } {
  const fromClient = clientUrl?.trim();
  if (fromClient) return { base: fromClient, fromClient: true };
  return { base: envUrl, fromClient: false };
}

function ollamaV1Url(baseUrl: string | undefined, resource: string): string {
  if (!baseUrl?.trim()) {
    throw new Error('Ollama is not configured. Set the Ollama URL in Settings or OLLAMA_BASE_URL on the server.');
  }
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error('Ollama URL must be a full http(s) URL, e.g. http://localhost:11434.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Ollama URL must be an http(s) URL without credentials, query or fragment.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = `${path.endsWith('/v1') ? path : `${path}/v1`}/${resource}`;
  return url.toString();
}

export function ollamaCompletionUrl(baseUrl = process.env.OLLAMA_BASE_URL): string {
  return ollamaV1Url(baseUrl, 'chat/completions');
}

export function ollamaModelsUrl(baseUrl = process.env.OLLAMA_BASE_URL): string {
  return ollamaV1Url(baseUrl, 'models');
}

/** Extracts the sorted, de-duplicated model ids from an OpenAI-compatible /v1/models body. */
export function parseOllamaModels(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((m) => (m as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200);
  return [...new Set(ids)].sort();
}
