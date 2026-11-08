import test from 'node:test';
import assert from 'node:assert/strict';
import { ollamaCompletionUrl, ollamaModelsUrl, parseOllamaModels, resolveOllamaBase } from '../lib/ollama.ts';
import { assertOllamaDestinationAllowed, isForbiddenOllamaIp } from '../lib/safe-url.ts';

test('Ollama URL from Settings takes precedence over the server environment', () => {
  assert.deepEqual(resolveOllamaBase(' http://lan:11434 ', 'http://env:11434'), { base: 'http://lan:11434', fromClient: true });
  for (const empty of [undefined, '', '   ']) {
    assert.deepEqual(resolveOllamaBase(empty, 'http://env:11434'), { base: 'http://env:11434', fromClient: false });
  }
  assert.deepEqual(resolveOllamaBase('', undefined), { base: undefined, fromClient: false });
});

test('Ollama destination keeps private hosts reachable but refuses link-local and reserved ones', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.1.1', '192.168.1.10', '100.64.0.1', '::1', 'fd00::1']) {
    assert.equal(isForbiddenOllamaIp(ip), false, ip);
    await assertOllamaDestinationAllowed(`http://${ip.includes(':') ? `[${ip}]` : ip}:11434/v1/chat/completions`);
  }
  for (const ip of ['169.254.169.254', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::', 'fe80::1', 'ff02::1', '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe']) {
    assert.equal(isForbiddenOllamaIp(ip), true, ip);
  }
  for (const host of ['169.254.169.254', '[fe80::1]', '[::ffff:a9fe:a9fe]', '0.0.0.0']) {
    await assert.rejects(assertOllamaDestinationAllowed(`http://${host}:80/v1/models`), /not allowed/, host);
  }
});

test('Ollama URL from Settings must be a plain http(s) URL', () => {
  for (const base of ['localhost:11434', 'ftp://localhost', 'http://u:p@localhost:11434', 'http://localhost:11434?x=1']) {
    assert.throws(() => ollamaModelsUrl(base), base);
  }
});

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
