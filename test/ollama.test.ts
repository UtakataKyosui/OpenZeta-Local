import test from 'node:test';
import assert from 'node:assert/strict';
import { ollamaCompletionUrl, ollamaModelsUrl, parseOllamaModels } from '../lib/ollama.ts';

test('Ollama models URL follows the same server-owned base as completions', () => {
  assert.equal(ollamaModelsUrl('http://localhost:11434'), 'http://localhost:11434/v1/models');
  assert.equal(ollamaModelsUrl('http://ollama:11434/v1/'), 'http://ollama:11434/v1/models');
  assert.throws(() => ollamaModelsUrl(''));
  assert.throws(() => ollamaModelsUrl('http://localhost:11434?url=x'));
});

test('Ollama models are extracted, de-duplicated and sorted', () => {
  assert.deepEqual(
    parseOllamaModels({ data: [{ id: 'qwen3:8b' }, { id: 'llama3.2' }, { id: 'qwen3:8b' }, { id: '' }, { id: 1 }, null] }),
    ['llama3.2', 'qwen3:8b']
  );
  for (const body of [null, undefined, {}, { data: 'x' }, []]) {
    assert.deepEqual(parseOllamaModels(body), []);
  }
});

test('Ollama accepts server-owned host, container and /v1 URLs', () => {
  for (const [base, expected] of [
    ['http://localhost:11434', 'http://localhost:11434/v1/chat/completions'],
    ['http://ollama:11434/v1/', 'http://ollama:11434/v1/chat/completions'],
    ['http://host.docker.internal:11434/', 'http://host.docker.internal:11434/v1/chat/completions'],
  ]) {
    assert.equal(ollamaCompletionUrl(base), expected);
  }
  assert.equal(ollamaCompletionUrl('https://example.com/ollama/v1'), 'https://example.com/ollama/v1/chat/completions');
});

test('Ollama rejects missing or unsafe server configuration', () => {
  for (const base of ['', '  ', 'not-a-url', 'file:///tmp/ollama', 'http://user:pass@localhost:11434', 'http://localhost:11434?url=x', 'http://localhost:11434/#x']) {
    assert.throws(() => ollamaCompletionUrl(base));
  }
});
