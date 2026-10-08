import { test, expect } from '@playwright/test';
import { projectRequest, ProjectRequestError } from '../../src/lib/projects/client';
import { assertProjectPayload, readJsonResponse, retryDelay } from '../../src/lib/http/response';
import { permanentPollingError, pollingDelay } from '../../src/lib/agents/polling';

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('HTML and malformed JSON become typed recoverable transport errors', async () => {
	for (const response of [new Response('<html>bad gateway</html>', { status: 502 }), new Response('{', { headers: { 'Content-Type': 'application/json' } })]) {
		globalThis.fetch = async () => response;
		await expect(projectRequest('/')).rejects.toMatchObject({ status: 503, code: 'invalid_response' });
	}
});

test('missing catalog shape cannot pass a TypeScript generic', async () => {
	globalThis.fetch = async () => Response.json({ ok: true });
	await expect(projectRequest('/project/tools?summary=true')).rejects.toMatchObject({ code: 'invalid_response' });
	expect(() => assertProjectPayload('/project/executions/run?view=status', { id: 'run', status: 'running', final_answer: null })).toThrow();
});

test('caller abort reaches fetch and stays a cancellation', async () => {
	let aborted = false;
	globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
		init!.signal!.addEventListener('abort', () => { aborted = true; reject(init!.signal!.reason); });
	});
	const controller = new AbortController();
	const pending = projectRequest('/', { signal: controller.signal });
	controller.abort();
	await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	expect(aborted).toBe(true);
});

test('Retry-After and permanent failures have distinct polling behavior', async () => {
	globalThis.fetch = async () => Response.json({ error: 'Slow down' }, { status: 429, headers: { 'Retry-After': '12' } });
	await expect(projectRequest('/')).rejects.toMatchObject({ status: 429, retryAfterMs: 12000 });
	expect(permanentPollingError(new ProjectRequestError(404, 'Removed'))).toBe(true);
	expect(permanentPollingError(new ProjectRequestError(503, 'Unavailable'))).toBe(false);
	expect(permanentPollingError(new ProjectRequestError(429, 'Busy'))).toBe(false);
	expect(pollingDelay(1, 0, 0.5)).toBe(2000);
	expect(pollingDelay(2, 0, 0.5)).toBe(4000);
	expect(pollingDelay(8, 0, 0.5)).toBe(30000);
	expect(pollingDelay(1, 60000, 0.5)).toBe(60000);
	expect(retryDelay('Thu, 08 Oct 2026 12:00:00 GMT', Date.parse('2026-10-08T11:59:50Z'))).toBe(10000);
	await expect(readJsonResponse(Response.json({ ok: true }))).resolves.toEqual({ ok: true });
});
