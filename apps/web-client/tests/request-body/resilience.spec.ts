import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';

const origin = 'http://127.0.0.1:3102';
const projectId = '11111111-1111-4111-8111-111111111111';
const agentId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const toolId = '44444444-4444-4444-8444-444444444444';
const spanId = '55555555-5555-4555-8555-555555555555';
const userId = '66666666-6666-4666-8666-666666666666';
const now = '2026-10-08T12:00:00Z';
const project = { id: projectId, name: 'Audit workspace', description: null, role: 'owner', created_by: userId, created_at: now, updated_at: now };
const agent = { id: agentId, name: 'Audit agent', description: '', revision: 1, enabled: true, tool_count: 1, model_settings: { provider: 'openai', model: 'fixture', temperature: null }, created_at: now };
const tool = { id: toolId, server_id: agentId, server_name: 'Demo', server_enabled: true, name: 'lookup', revision: 1, enabled: true, available: true, definition: { input_schema: { type: 'object', properties: {} } } };
const span = { id: spanId, sequence: 1, parent_id: null, kind: 'model', name: 'Model turn 1', status: 'success', call_id: null, tool_id: null, tool_revision: null, tool_execution_id: null, context_span_ids: [], error_code: null, duration_ms: 10 };
let statusCode = 200, failures = 0, runStatus = 'running', lostWrite = false, savedRequest = '';
let counts: Record<string, number> = {};
const backend = createServer((request, response) => {
	request.resume();
	const url = new URL(request.url!, 'http://mock.invalid');
	const path = url.pathname;
	counts[path] = (counts[path] ?? 0) + 1;
	const send = (value: unknown, status = 200, headers: Record<string, string> = {}) => { response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(value)); };
	if (path.endsWith('/auth/me')) return send({ id: userId, email: 'audit@example.com', display_name: 'Audit user' });
	if (path === '/api/v1/projects') return send({ items: [project], next_cursor: null });
	if (path.endsWith(`/projects/${projectId}`)) return send(project);
	if (path.endsWith('/agents')) return send({ items: [agent], next_offset: null });
 if (path.endsWith(`/agents/${agentId}`) || path.includes(`/agents/${agentId}/revisions/`)) return send({ ...agent, revision: Number(path.split('/').at(-1)) || 1, current_revision: 1, system_prompt: null, agent_prompt: null, tools: [], limits: { max_turns: 16, max_tool_calls: 20, timeout_seconds: 60, max_output_tokens: 2048 }, configuration_issues: [], configuration_ready: true });
 if (path.endsWith(`/agents/${agentId}/revisions`)) return send({ items: [{ ...agent, revision: url.searchParams.has('offset') ? 2 : 1 }], next_offset: url.searchParams.has('offset') ? null : 1 });

	if (path.endsWith('/tools')) {
		if (url.searchParams.get('summary') === 'true') return send({ items: url.searchParams.get('q') ? [] : [{ ...tool, definition: undefined, description: 'Lookup products' }], next_offset: url.searchParams.has('offset') ? null : 100 });
		return send({ items: [tool], next_offset: null });
	}
	if (path.endsWith('/prompts')) return send({ items: [], next_offset: 20 });
	if (path.endsWith('/spans')) return send({ items: [span], next_offset: null });
	if (path.endsWith(`/spans/${spanId}`)) return send({ ...span, inputs: { task: 'A large input' }, outputs: { text: 'Payload loaded on demand' } });
	if (path.endsWith('/snapshot')) return send({ snapshot: { model_settings: agent.model_settings } });
	if (path.includes('/executions/requests/')) {
		savedRequest = path.split('/').at(-1)!;
		return send({ id: runId, revision: 1, status: 'success', inputs: {}, result: { content: [{ type: 'text', text: 'Recovered result' }] }, error_code: null, duration_ms: 10, created_at: now });
	}
	if (path.endsWith(`/tools/${toolId}/executions`)) {
		if (request.method === 'POST') return send({ error: 'Response lost' }, lostWrite ? 503 : 200);
		return send({ items: [] });
	}
	if (path.endsWith(`/agents/${agentId}/executions`)) return request.method === 'POST' ? send({ id: runId, status: 'queued' }, 202) : send({ items: [], next_offset: null });
	if (path.endsWith(`/executions/${runId}`)) {
		if (url.searchParams.get('view') === 'status' && (failures-- > 0 || statusCode !== 200)) return send({ error: 'Unavailable' }, statusCode === 200 ? 503 : statusCode, { 'Retry-After': '4' });
		return send({ id: runId, agent_revision: 1, ...(url.searchParams.get('view') === 'summary' ? { input: 'Find price' } : {}), status: runStatus,
			termination_reason: runStatus === 'completed' ? 'final_answer' : null, final_answer: runStatus === 'completed' ? 'Completed answer' : null,
			created_at: now, finished_at: runStatus === 'completed' ? now : null, model_turns: 1, tool_calls: 0, failure_hint: null });
	}
	send({ error: 'Not found' }, 404);
});
test.beforeAll(async () => { await new Promise<void>((resolve, reject) => { backend.once('error', reject); backend.listen(3103, '127.0.0.1', resolve); }); });
test.afterAll(async () => { await new Promise<void>((resolve, reject) => backend.close(error => error ? reject(error) : resolve())); });
test.beforeEach(async ({ context }) => {
	statusCode = 200; failures = 0; runStatus = 'running'; lostWrite = false; savedRequest = ''; counts = {};
	await context.addCookies([{ name: 'agent_access_token', value: 'fixture-token', url: origin, httpOnly: true }]);
});
async function start(page: Page) {
	await page.goto(`/projects/${projectId}/agents`);
	await page.getByRole('button', { name: 'Playground Audit agent', exact: true }).click();
	await page.getByRole('dialog').getByLabel('Task', { exact: true }).fill('Find price');
	await page.getByRole('dialog').getByLabel('Task', { exact: true }).press('Control+Enter');
	await expect(page.getByRole('dialog').getByText('Find price', { exact: true })).toBeVisible();
}

test('production CSP gives fresh nonces, hydrates pages, and blocks injected inline handlers', async ({ page, request, context }) => {
	await context.clearCookies();
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	const first = await request.get('/auth/signin'), second = await request.get('/auth/signin');
	const csp = first.headers()['content-security-policy'];
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).not.toContain('unsafe-eval');
	expect(csp).not.toBe(second.headers()['content-security-policy']);
	expect(first.headers()['x-content-type-options']).toBe('nosniff');
	expect(first.headers()['x-frame-options']).toBe('DENY');
	await page.goto('/auth/signin');
	await page.getByRole('tab', { name: 'Create account' }).click();
	await expect(page.getByLabel('Display name')).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.dataset.theme)).toMatch(/light|dark/);
	const inline = await page.evaluate(() => [...document.scripts].filter(script => !script.src).map(script => script.nonce));
	expect(inline.length).toBeGreaterThan(0);
	expect(inline.every(Boolean)).toBe(true);
	await page.evaluate(() => {
		document.addEventListener('securitypolicyviolation', event => document.body.dataset.blockedDirective = event.effectiveDirective);
		const image = document.createElement('img');
		image.setAttribute('onerror', 'window.injectedAuditScript = true');
		image.src = '/audit-missing-image.png';
		document.body.append(image);
	});
	await expect(page.locator('body')).toHaveAttribute('data-blocked-directive', 'script-src-attr');
	expect(await page.evaluate(() => 'injectedAuditScript' in window)).toBe(false);
	expect(errors).toEqual([]);
});

test('permanent polling errors stop and manual reconnect recovers', async ({ page }) => {
	statusCode = 404;
	await start(page);
	await expect(page.getByRole('button', { name: 'Reconnect execution' })).toBeVisible();
	const path = `/api/v1/projects/${projectId}/executions/${runId}`;
	const before = counts[path];
	await page.waitForTimeout(2300);
	expect(counts[path]).toBe(before);
	statusCode = 200; runStatus = 'completed';
	await page.getByRole('button', { name: 'Reconnect execution' }).click();
	await expect(page.locator('.execution-answer')).toContainText('Completed answer');
});

test('Retry-After backs off without history storms and hidden tabs pause polling', async ({ page }) => {
	failures = 1;
	await start(page);
	const history = `/api/v1/projects/${projectId}/agents/${agentId}/executions`;
	const detail = `/api/v1/projects/${projectId}/executions/${runId}`;
	await expect(page.getByRole('dialog').getByRole('alert')).toContainText('temporarily unavailable');
	const before = counts[history], observed = counts[detail];
	await page.waitForTimeout(1800);
	expect(counts[detail]).toBe(observed);
	expect(counts[history]).toBe(before);
	await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
	await page.waitForTimeout(3200);
	expect(counts[detail]).toBe(observed);
	runStatus = 'completed';
	await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
	await expect(page.locator('.execution-answer')).toContainText('Completed answer');
});

test('trace payloads and snapshot are fetched only when opened', async ({ page }) => {
	runStatus = 'completed'; await start(page);
	const base = `/api/v1/projects/${projectId}/executions/${runId}`;
	expect(counts[`${base}/spans`]).toBeUndefined();
	await page.locator('.playground-details > summary').click();
	await expect(page.locator('.execution-span')).toHaveCount(1);
	expect(counts[`${base}/spans/${spanId}`]).toBeUndefined();
	expect(counts[`${base}/snapshot`]).toBeUndefined();
	await page.locator('.execution-span > summary').click();
	await expect(page.locator('.trace-payloads')).toContainText('Payload loaded on demand');
	await page.locator('.playground-configuration > summary').click();
	await expect(page.locator('.playground-configuration pre')).toContainText('model_settings');
});

test('tool write recovery survives reload without repeating a POST or persisting arguments', async ({ page }) => {
	lostWrite = true;
	await page.goto(`/projects/${projectId}/tools`);
	await page.getByRole('button', { name: 'Manage', exact: true }).click();
	await page.getByRole('dialog').getByRole('checkbox').check();
	await page.getByRole('button', { name: 'Run tool', exact: true }).click();
	await expect(page.locator('.tool-warning')).toBeVisible();
	const keys = await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('agent-tool-operation:')).map(key => sessionStorage.getItem(key)));
	expect(keys).toHaveLength(1);
	expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
	const executions = `/api/v1/projects/${projectId}/tools/${toolId}/executions`;
	const before = counts[executions];
	await page.reload();
	await page.getByRole('button', { name: 'Manage', exact: true }).click();
	await expect(page.locator('.tool-output').first()).toContainText('Recovered result');
	expect(savedRequest).toBe(keys[0]);
	// Reload caused another history GET, but no second execution POST.
	expect(counts[executions]).toBe(before + 1);
	expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('agent-tool-operation:')))).toHaveLength(0);
});

test('catalog picker loads one page, retains selection and searches summaries', async ({ page }) => {
	await page.goto(`/projects/${projectId}/agents`);
	await page.getByRole('button', { name: 'Create agent', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: /Tools$/ }).click();
	await expect(page.getByRole('checkbox').first()).toBeVisible();
	const path = `/api/v1/projects/${projectId}/tools`;
	expect(counts[path]).toBe(1);
	await page.getByRole('checkbox').first().check();
	await page.getByLabel('Search tools', { exact: true }).fill('missing');
	await expect(page.getByText('No matching tools.', { exact: false })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Remove selection' })).toBeVisible();
	expect(counts[path]).toBe(2);
});


test('agent revision pagination preserves versions sharing an ID and closing restores scroll/focus', async ({ page }) => {
 await page.goto(`/projects/${projectId}/agents`);
 const opener = page.getByRole('button', { name: 'Manage Audit agent', exact: true });
 await opener.click();
 const dialog = page.getByRole('dialog');
 await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Audit agent');
 expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
 await dialog.getByRole('button', { name: 'History', exact: true }).click();
 await expect(dialog.getByRole('button', { name: 'View revision 1', exact: true })).toBeVisible();
 await dialog.getByRole('button', { name: 'Load older revisions' }).click();
 await expect(dialog.getByRole('button', { name: 'View revision 1', exact: true })).toBeVisible();
 await expect(dialog.getByRole('button', { name: 'View revision 2', exact: true })).toBeVisible();
 await dialog.getByRole('button', { name: 'View revision 2', exact: true }).click();
 await expect(dialog.getByRole('heading', { name: 'Revision 2', exact: true })).toBeVisible();
 await dialog.getByRole('button', { name: 'Close', exact: true }).click();
 await expect(dialog).toHaveCount(0);
 await expect(opener).toBeFocused();
 expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('editing an agent protects a dirty draft and keeps it when discard is declined', async ({ page }) => {
 await page.goto(`/projects/${projectId}/agents`);
 await page.getByRole('button', { name: 'Manage Audit agent', exact: true }).click();
 const dialog = page.getByRole('dialog');
 await dialog.getByLabel('Name', { exact: true }).fill('Unsaved name');
 await dialog.getByRole('button', { name: 'Close', exact: true }).click();
 await expect(dialog.getByText('You have unsaved changes.')).toBeVisible();
 await dialog.getByRole('button', { name: 'Keep editing' }).click();
 await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Unsaved name');
 await dialog.getByRole('button', { name: 'Close', exact: true }).click();
 await dialog.getByRole('button', { name: 'Discard changes' }).click();
 await expect(dialog).toHaveCount(0);
});
