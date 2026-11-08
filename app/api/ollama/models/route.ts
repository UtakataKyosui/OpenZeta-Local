import { NextResponse } from 'next/server';
import { ollamaModelsUrl, parseOllamaModels } from '@/lib/ollama';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const TIMEOUT_MS = 5_000;

/**
 * サーバーに設定された Ollama の取得済みモデル一覧を返す。
 * 宛先は OLLAMA_BASE_URL のみから決まり、クライアントは指定できない。
 */
export async function GET() {
  let url: string;
  try {
    url = ollamaModelsUrl();
  } catch {
    return NextResponse.json(
      { error: 'Ollama is not configured correctly. Set OLLAMA_BASE_URL on the server.' },
      { status: 400, headers: NO_STORE }
    );
  }

  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return NextResponse.json(
        { error: `Ollama returned status ${response.status}.` },
        { status: 502, headers: NO_STORE }
      );
    }
    const models = parseOllamaModels(await response.json().catch(() => null));
    return NextResponse.json({ models }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return NextResponse.json({ error: 'Ollama timed out.' }, { status: 504, headers: NO_STORE });
    }
    return NextResponse.json(
      { error: 'Failed to reach Ollama.' },
      { status: 502, headers: NO_STORE }
    );
  }
}
