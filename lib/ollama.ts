/** Server-owned Ollama destination. Request bodies may select only the alias. */
export function ollamaCompletionUrl(baseUrl = process.env.OLLAMA_BASE_URL): string {
  if (!baseUrl?.trim()) {
    throw new Error('Ollama is not configured. Set OLLAMA_BASE_URL on the server.');
  }
  const url = new URL(baseUrl.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('OLLAMA_BASE_URL must be an http(s) URL without credentials, query or fragment.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = `${path.endsWith('/v1') ? path : `${path}/v1`}/chat/completions`;
  return url.toString();
}
