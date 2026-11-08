// Run after npm run build. Exercises the real routes against a local mock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const requests = [];
const modelRequests = [];
let redirect = false;
let modelsStatus = 200;
const mock = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    modelRequests.push({ headers: req.headers });
    if (redirect) {
      res.writeHead(302, { Location: 'http://127.0.0.1:1/private' }).end();
    } else if (modelsStatus !== 200) {
      res.writeHead(modelsStatus).end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen3:8b' }, { id: 'llama3.2:latest' }, { id: 'qwen3:8b' }] }));
    }
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body);
  requests.push({ url: req.url, headers: req.headers, payload });
  if (redirect) {
    res.writeHead(302, { Location: 'http://127.0.0.1:1/private' }).end();
  } else if (payload.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"こんにちは"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\ndata: [DONE]\n\n');
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"replies":["こんにちは","元気？","話そう"]}' } }] }));
  }
});
mock.listen(0, '127.0.0.1');
await once(mock, 'listening');

// The standalone server treats PORT=0 as unset and falls back to 3000, so reserve a free port.
async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  probe.close();
  await once(probe, 'close');
  return port;
}

async function startApp(ollamaUrl) {
  const app = spawn(process.execPath, ['.next/standalone/server.js'], {
    env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(await freePort()), OLLAMA_BASE_URL: ollamaUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  app.stdout.on('data', chunk => { output += chunk; });
  app.stderr.on('data', chunk => { output += chunk; });
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        const origin = match[0];
        if (await fetch(`${origin}/api/health`).then(r => r.ok).catch(() => false)) {
          return { app, origin };
        }
      }
      if (app.exitCode !== null) throw new Error(output);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not start: ${output}`);
  } catch (error) {
    app.kill();
    throw error;
  }
}

const payload = {
  baseUrl: '/api/ollama', apiKey: 'must-not-be-forwarded', modelName: 'local-test',
  messages: [{ role: 'user', content: 'こんにちは' }], characterName: 'ルナ',
};
function post(origin, route, overrides = {}) {
  return fetch(`${origin}/api/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ...overrides }),
  });
}

let running;
try {
  running = await startApp(`http://127.0.0.1:${mock.address().port}`);
  const response = await post(running.origin, 'chat');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const stream = await response.text();
  assert.match(stream, /こんにちは/);
  assert.match(stream, /"total_tokens":7/);
  assert.match(stream, /data: \[DONE\]/);
  assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[0].payload.model, 'local-test');
  assert.equal(requests[0].payload.stream, true);

  const replies = await post(running.origin, 'smart-reply');
  assert.equal(replies.status, 200);
  assert.deepEqual(await replies.json(), { replies: ['こんにちは', '元気？', '話そう'] });
  assert.equal(requests[1].payload.stream, false);
  assert.equal(requests[1].payload.response_format.type, 'json_object');

  for (const baseUrl of ['http://127.0.0.1:11434/v1', '/api/ollama?url=http://127.0.0.1:1']) {
    for (const route of ['chat', 'smart-reply']) {
      assert.equal((await post(running.origin, route, { baseUrl })).status, 400);
    }
  }
  assert.equal(requests.length, 2, 'rejected URLs must not reach Ollama');
  assert.equal((await post(running.origin, 'chat', { messages: [] })).status, 400);

  const models = await fetch(`${running.origin}/api/ollama/models`);
  assert.equal(models.status, 200);
  assert.equal(models.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await models.json(), { models: ['llama3.2:latest', 'qwen3:8b'] });
  assert.equal(modelRequests.length, 1);
  assert.equal(modelRequests[0].headers.authorization, undefined);
  const ignored = await fetch(`${running.origin}/api/ollama/models?url=http://127.0.0.1:1`);
  assert.equal(ignored.status, 200);
  assert.equal(modelRequests.length, 2, 'the query string must not change the destination');
  modelsStatus = 500;
  const upstreamError = await fetch(`${running.origin}/api/ollama/models`);
  assert.equal(upstreamError.status, 502);
  modelsStatus = 200;

  redirect = true;
  for (const route of ['chat', 'smart-reply']) {
    const res = await post(running.origin, route);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /redirect/);
  }
  assert.equal((await fetch(`${running.origin}/api/ollama/models`)).status, 502, 'redirects must not be followed');
  running.app.kill();
  await once(running.app, 'exit');
  running = await startApp('');
  for (const route of ['chat', 'smart-reply']) {
    const res = await post(running.origin, route);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /OLLAMA_BASE_URL/);
  }
  const unconfigured = await fetch(`${running.origin}/api/ollama/models`);
  assert.equal(unconfigured.status, 400);
  assert.match((await unconfigured.json()).error, /OLLAMA_BASE_URL/);
  console.log('Ollama route integration checks passed (stream, usage, replies, models, validation, SSRF, redirects, missing configuration).');
} finally {
  if (running && running.app.exitCode === null) {
    running.app.kill();
    await once(running.app, 'exit');
  }
  mock.close();
}
