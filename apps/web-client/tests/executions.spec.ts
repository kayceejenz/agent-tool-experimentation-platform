import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { test, ORIGIN } from './fixtures';

test('inspect tool lineage, context links, saved snapshots and execution history', async ({ page, context }) => {
	const headers = { Origin: ORIGIN };
	const project = await (await context.request.post('/api/projects', { headers, data: { name: 'Execution workspace' } })).json();
	const base = `/api/projects/${project.id}`;
	const refs: Record<string, { id: string; revision: number }> = {};
	for (const type of ['system', 'agent']) {
		const prompt = await (await context.request.post(`${base}/prompts`, { headers, data: { name: `${type} prompt`, type, content: 'Use available evidence.' } })).json();
		refs[`${type}_prompt`] = { id: prompt.id, revision: 1 };
	}
	const created = await context.request.post(`${base}/agents`, { headers, data: { name: 'Trace agent', ...refs, model_settings: { provider: 'openai', model: 'fixture' } } });
	expect(created.status()).toBe(201);
	const agent = await created.json();
	await context.request.patch(`${base}/agents/${agent.id}`, { headers, data: { enabled: true, base_revision: 1 } });
	const runId = '11111111-1111-4111-8111-111111111111';
	const first = '22222222-2222-4222-8222-222222222222';
	const tool = '33333333-3333-4333-8333-333333333333';
	const final = '44444444-4444-4444-8444-444444444444';
	const run = { id: runId, agent_revision: 1, input: 'Find price', status: 'completed', termination_reason: 'final_answer', final_answer: 'Product ABC costs £29.', created_at: '2026-10-05T12:00:00Z', finished_at: '2026-10-05T12:00:01Z', snapshot: { model_settings: { provider: 'openai', model: 'fixture' }, limits: { max_turns: 8 } }, spans: [
		{ id: first, sequence: 1, parent_id: null, kind: 'model', name: 'Model turn 1', status: 'success', context_span_ids: [], inputs: { message_count: 1 }, outputs: [{ text: '', tool_calls: [{ name: 'lookup', id: 'call-abc' }] }], duration_ms: 120 },
		{ id: tool, sequence: 2, parent_id: first, kind: 'tool', name: 'Store / lookup', status: 'success', call_id: 'call-abc', tool_revision: 1, tool_execution_id: 'executor-record', context_span_ids: [], inputs: { sku: 'ABC' }, outputs: { price: 29, currency: 'GBP' }, duration_ms: 80 },
		{ id: final, sequence: 3, parent_id: null, kind: 'model', name: 'Model turn 2', status: 'success', context_span_ids: [tool], inputs: { message_count: 3 }, outputs: [{ text: 'Product ABC costs £29.' }], duration_ms: 130 },
	] };
	await page.route(`**${base}/agents/${agent.id}/executions`, async (route) => {
		if (route.request().method() === 'POST') {
			expect(route.request().postDataJSON().input).toBe('Find price');
			await route.fulfill({ status: 202, json: { id: runId, status: 'queued' } });
		} else await route.fulfill({ json: { items: [run], next_offset: null } });
	});
	await page.route(`**${base}/executions/${runId}**`, (route) => {
        const path = new URL(route.request().url()).pathname;
        const { snapshot, spans, ...overview } = run;
        if (path.endsWith('/snapshot')) return route.fulfill({ json: { snapshot } });
        if (path.endsWith('/spans')) return route.fulfill({ json: { items: spans.map(span => ({ id: span.id, sequence: span.sequence, parent_id: span.parent_id, kind: span.kind, name: span.name, status: span.status, context_span_ids: span.context_span_ids, duration_ms: span.duration_ms, error_code: null, call_id: span.call_id ?? null, tool_revision: span.tool_revision ?? null, tool_execution_id: span.tool_execution_id ?? null })), next_offset: null } });
        const span = spans.find(span => path.endsWith(`/spans/${span.id}`));
        if (span) return route.fulfill({ json: span });
        return route.fulfill({ json: { ...overview, model_turns: spans.filter(span => span.kind === 'model').length, tool_calls: spans.filter(span => span.kind === 'tool').length, failure_hint: null } });
    });
	await page.goto(`/projects/${project.id}/agents`);
	await page.reload();
	// Mimic shared CSS arriving after the playground chunk during a cold reload.
	await page.addStyleTag({ content: ['mcp-servers.css', 'agents.css'].map((file) => readFileSync(resolve('src/app', file), 'utf8')).join('\n') });
	await page.getByRole('button', { name: 'Playground Trace agent', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toHaveCSS('display', 'flex');
	await expect(dialog).toHaveCSS('border-radius', '16px');
	await expect(dialog.locator('.playground-header')).toHaveCSS('display', 'grid');
	const bounds = await dialog.boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.width).toBe(Math.min(920, page.viewportSize()!.width - 48));
	expect(bounds!.height).toBe(Math.min(680, page.viewportSize()!.height - 48));
	expect(Math.abs(bounds!.x - (page.viewportSize()!.width - bounds!.width) / 2)).toBeLessThan(2);
	await page.screenshot({ path: 'test-results/playground-composer-desktop.png' });
	await dialog.getByLabel('Task', { exact: true }).fill('Find price');
	await dialog.getByLabel('Task', { exact: true }).press('Control+Enter');
	await expect(dialog.getByRole('status')).toContainText('completed');
	await expect(dialog.locator('.execution-answer')).toContainText('Product ABC costs £29.');
	await expect(dialog.locator('.execution-span')).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Copy answer' })).toBeVisible();
	await page.screenshot({ path: 'test-results/playground-answer-desktop.png' });
	await dialog.locator('.playground-details > summary').click();
	await expect(dialog.locator('.execution-turn').first().locator('.execution-children')).toContainText('Store / lookup');
	await dialog.locator(`#span-${final} > summary`).click();
	await dialog.getByRole('link', { name: '#2 Store / lookup' }).click();
	await expect(dialog.locator(`#span-${tool}`)).toHaveAttribute('open', '');
	await dialog.locator(`#span-${tool} .trace-identifiers summary`).click();
	await expect(dialog.locator(`#span-${tool}`)).toContainText('call-abc');
	await expect(dialog.locator(`#span-${tool}`)).toContainText('executor-record');
	await expect(dialog.locator(`#span-${tool} pre`).first()).toContainText('ABC');
	await dialog.locator('.playground-configuration > summary').click();
	await expect(dialog.getByText('"max_turns": 8', { exact: false })).toBeVisible();
	await dialog.locator('.playground-configuration > summary').click();
	await dialog.locator(`#span-${first} > summary`).first().click();
	await page.screenshot({ path: 'test-results/execution-stack-desktop.png' });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(dialog.getByLabel('Task', { exact: true })).not.toBeVisible();
	await expect(dialog.locator('.execution-answer')).toBeVisible();
	await expect(dialog.locator('.playground-task-message')).toContainText('Find price');
	await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
	await page.screenshot({ path: 'test-results/execution-stack-mobile.png' });
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await page.getByRole('button', { name: 'Playground Trace agent', exact: true }).click();
	await dialog.getByRole('button', { name: 'History', exact: true }).click();
	await dialog.locator('.execution-history button').click();
	await expect(dialog.locator('.execution-answer')).toContainText('£29');
	await dialog.getByRole('button', { name: 'Edit and run again', exact: true }).click();
	await expect(dialog.getByLabel('Task', { exact: true })).toHaveValue('Find price');
	await expect(dialog.locator('.execution-answer')).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Run task', exact: true })).toBeEnabled();
	await page.screenshot({ path: 'test-results/playground-composer-mobile.png' });
	// A running task exposes Stop without bringing back the task editor.
	run.status = 'running'; run.final_answer = ''; run.spans = [];
	await page.route(`**${base}/executions/${runId}/cancel`, async (route) => {
		run.status = 'cancelled'; run.termination_reason = 'cancelled';
		await route.fulfill({ json: run });
	});
	await dialog.getByRole('button', { name: 'Run task', exact: true }).click();
	await expect(dialog.getByRole('status')).toContainText('running');
	await dialog.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(dialog.getByRole('status')).toContainText('cancelled');
	await expect(dialog.getByRole('heading', { name: 'Task stopped' })).toBeVisible();
	await dialog.getByRole('button', { name: 'New task', exact: true }).click();
	await expect(dialog.getByLabel('Task', { exact: true })).toHaveValue('');
	// Long inputs remain readable without pushing the answer below the fold.
	run.status = 'completed'; run.final_answer = 'Product ABC costs £29.';
	run.input = 'A detailed task. '.repeat(80);
	await dialog.getByRole('button', { name: 'History', exact: true }).click();
	await dialog.locator('.execution-history button').click();
	await expect(dialog.locator('.playground-task-preview')).toBeVisible();
	await dialog.getByRole('button', { name: 'Show full task' }).click();
	await expect(dialog.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
	await dialog.getByRole('button', { name: 'Show less' }).click();
	await expect(dialog.locator('.playground-task-preview')).toBeVisible();
	await expect(dialog).toHaveJSProperty('scrollWidth', await dialog.evaluate((element) => element.clientWidth));
});
