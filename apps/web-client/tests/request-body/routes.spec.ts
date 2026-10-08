import { test, expect } from '@playwright/test';
import { createServer, request as httpRequest } from 'node:http';
import { BODY_LIMITS } from '../../src/lib/http/request-body';

const origin = 'http://127.0.0.1:3102';
const project = '11111111-1111-4111-8111-111111111111';
const item = '22222222-2222-4222-8222-222222222222';
const base = `/api/projects/${project}`;
const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: 'agent_access_token=test-token' };
let forwarded = 0;
const backend = createServer((request, response) => {
	forwarded++;
	request.resume();
	response.writeHead(200, { 'Content-Type': 'application/json' });
	response.end('{"ok":true}');
});
test.beforeAll(async () => {
	await new Promise<void>((resolve, reject) => {
		backend.once('error', reject);
		backend.listen(3103, '127.0.0.1', resolve);
	});
});
test.afterAll(async () => {
	await new Promise<void>((resolve, reject) => backend.close(error => error ? reject(error) : resolve()));
});

const endpoints = [
	['/api/auth/login', 'POST', BODY_LIMITS.auth],
	['/api/auth/register', 'POST', BODY_LIMITS.auth],
	['/api/auth/refresh', 'POST', BODY_LIMITS.control],
	['/api/auth/logout', 'POST', BODY_LIMITS.control],
	['/api/projects', 'POST', BODY_LIMITS.project],
	[base, 'PATCH', BODY_LIMITS.project],
	[`${base}/mcp-servers`, 'POST', BODY_LIMITS.mcp],
	[`${base}/mcp-servers/probe`, 'POST', BODY_LIMITS.mcp],
	[`${base}/mcp-servers/${item}`, 'PATCH', BODY_LIMITS.mcp],
	[`${base}/mcp-servers/${item}/check`, 'POST', BODY_LIMITS.mcp],
	[`${base}/mcp-servers/${item}/discover`, 'POST', BODY_LIMITS.mcp],
	[`${base}/tools/${item}`, 'PATCH', BODY_LIMITS.tool],
	[`${base}/tools/${item}/executions`, 'POST', BODY_LIMITS.tool],
	[`${base}/prompts`, 'POST', BODY_LIMITS.configuration],
	[`${base}/prompts/${item}/revisions`, 'POST', BODY_LIMITS.configuration],
	[`${base}/agents`, 'POST', BODY_LIMITS.configuration],
	[`${base}/agents/${item}/revisions`, 'POST', BODY_LIMITS.configuration],
	[`${base}/agents/${item}/executions`, 'POST', BODY_LIMITS.execution],
	[`${base}/executions/${item}/cancel`, 'POST', BODY_LIMITS.control],
] as const;

for (const [path, method, limit] of endpoints) {
	test(`${method} ${path} rejects oversize before forwarding`, async ({ request }) => {
		const before = forwarded;
		const response = await request.fetch(path, { method, headers, data: Buffer.alloc(limit + 1, 'x') });
		expect(response.status()).toBe(413);
		expect(await response.json()).toEqual({ error: 'Request body is too large.' });
		expect(response.headers()['cache-control']).toBe('no-store');
		expect(forwarded).toBe(before);
	});
}

test('rejects a chunked multibyte request without Content-Length before forwarding', async () => {
	const before = forwarded;
	// Fewer JS string units than the limit, but more UTF-8 bytes; explicitly chunked.
	const payload = JSON.stringify({ name: '😀'.repeat(5000) });
	expect(payload.length).toBeLessThan(BODY_LIMITS.project);
	const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
		const outgoing = httpRequest(`${origin}/api/projects`, {
			method: 'POST', headers: { ...headers, 'Transfer-Encoding': 'chunked' },
		}, response => {
			let body = '';
			response.setEncoding('utf8');
			response.on('data', chunk => { body += chunk; });
			response.on('end', () => resolve({ status: response.statusCode!, body }));
		});
		outgoing.on('error', reject);
		const bytes = Buffer.from(payload);
		outgoing.write(bytes.subarray(0, 8000));
		outgoing.end(bytes.subarray(8000));
	});
	expect(result.status).toBe(413);
	expect(JSON.parse(result.body)).toEqual({ error: 'Request body is too large.' });
	expect(forwarded).toBe(before);
});

test('malformed JSON is 400 and valid JSON at the exact cap still forwards', async ({ request }) => {
	const before = forwarded;
	const malformed = await request.post('/api/projects', { headers, data: Buffer.from('{') });
	expect(malformed.status()).toBe(400);
	expect(forwarded).toBe(before);
	const prefix = '{"name":"', suffix = '"}';
	const data = prefix + 'a'.repeat(BODY_LIMITS.project - prefix.length - suffix.length) + suffix;
	const valid = await request.post('/api/projects', { headers, data: Buffer.from(data) });
	expect(valid.status()).toBe(201);
	expect(await valid.json()).toEqual({ ok: true });
	expect(forwarded).toBe(before + 1);
});

test('origin and content type checks remain ahead of body parsing', async ({ request }) => {
	const before = forwarded;
	const data = 'x'.repeat(BODY_LIMITS.project + 1);
	expect((await request.post('/api/projects', { headers: { ...headers, Origin: 'https://foreign.example' }, data })).status()).toBe(403);
	expect((await request.post('/api/projects', { headers: { ...headers, 'Content-Type': 'text/plain' }, data })).status()).toBe(415);
	expect(forwarded).toBe(before);
});
