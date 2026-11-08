import { NextRequest, NextResponse } from 'next/server';
import { MAX_OLLAMA_URL_LENGTH, ollamaModelsUrl, parseOllamaModels, resolveOllamaBase } from '@/lib/ollama';
import { assertOllamaDestinationAllowed } from '@/lib/safe-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const TIMEOUT_MS = 5_000;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

/**
 * Ollama の取得済みモデル一覧を返す。
 * 宛先は ?url=（Settings の Ollama URL）を優先し、空なら OLLAMA_BASE_URL を使う。
 */
export async function GET(req: NextRequest) {
  const clientUrl = req.nextUrl.searchParams.get('url') ?? '';
  if (clientUrl.length > MAX_OLLAMA_URL_LENGTH) {
    return errorResponse('Ollama URL is too long.', 400);
  }

  const { base, fromClient } = resolveOllamaBase(clientUrl);
  let url: string;
  try {
    url = ollamaModelsUrl(base);
    if (fromClient) await assertOllamaDestinationAllowed(url);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Ollama is not configured correctly.',
      400
    );
  }

  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return errorResponse(`Ollama returned status ${response.status}.`, 502);
    }
    const models = parseOllamaModels(await response.json().catch(() => null));
    return NextResponse.json({ models }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return errorResponse('Ollama timed out.', 504);
    }
    return errorResponse('Failed to reach Ollama.', 502);
  }
}
