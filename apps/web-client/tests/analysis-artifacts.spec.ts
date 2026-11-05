import { expect } from '@playwright/test';
import { test, ORIGIN } from './fixtures';

const runId = 'a1111111-1111-4111-8111-111111111111';
const png = '11111111111111111111111111111111.png';
const csv = '22222222222222222222222222222222.csv';
const script = '33333333333333333333333333333333.py';
const expired = '44444444444444444444444444444444.txt';

test('preview and download generated charts, CSVs and Python; preserve results on refresh', async ({
	page,
	context,
}) => {
	const project = await (
		await context.request.post('/api/projects', {
			headers: { Origin: ORIGIN },
			data: { name: 'Generated files' },
		})
	).json();
	const refs: Record<string, { id: string; revision: number }> = {};
	for (const type of ['system', 'agent']) {
		const prompt = await (
			await context.request.post(`/api/projects/${project.id}/prompts`, {
				headers: { Origin: ORIGIN },
				data: { name: type, type, content: 'Analyse the selected files.' },
			})
		).json();
		refs[`${type}_prompt`] = { id: prompt.id, revision: 1 };
	}
	const agent = await (
		await context.request.post(`/api/projects/${project.id}/agents`, {
			headers: { Origin: ORIGIN },
			data: {
				name: 'Chart analyst',
				...refs,
				model_settings: { provider: 'openai', model: 'fixture' },
			},
		})
	).json();
	const path = `/api/projects/${project.id}/executions/${runId}`;
	const run = {
		id: runId,
		agent_revision: 1,
		input: 'Plot duration.',
		status: 'completed',
		termination_reason: 'final_answer',
		final_answer: 'A chart and summary table were generated.',
		created_at: '2026-11-04T12:00:00Z',
		finished_at: '2026-11-04T12:00:05Z',
		model_turns: 3,
		tool_calls: 2,
		failure_hint: null,
		analysis_dataset_id: 'd1111111-1111-4111-8111-111111111111',
	};
	await page.route(
		`**/api/projects/${project.id}/agents/${agent.id}/executions*`,
		route => route.fulfill({ json: { items: [run], next_offset: null } }),
	);
	await page.route(`**${path}?*`, route => route.fulfill({ json: run }));
	const files = [
		{
			id: png,
			name: 'duration.png',
			media_type: 'image/png',
			kind: 'generated',
			size_bytes: 100,
			availability: 'available',
			width: 1,
			height: 1,
		},
		{
			id: csv,
			name: 'summary.csv',
			media_type: 'text/csv',
			kind: 'generated',
			size_bytes: 30,
			availability: 'available',
		},
		{
			id: script,
			name: 'analysis_step_01.py',
			media_type: 'text/x-python',
			kind: 'code',
			size_bytes: 10,
			availability: 'available',
		},
		{
			id: expired,
			name: 'old.txt',
			media_type: 'text/plain',
			kind: 'generated',
			size_bytes: 20,
			availability: 'expired',
		},
	];
	let unavailable = true;
	await page.route(`**${path}/artifacts`, route =>
		unavailable
			? route.fulfill({
					status: 503,
					json: { error: 'Files temporarily unavailable.' },
				})
			: route.fulfill({
					json: {
						items: files,
						warnings: [],
						expires_at: '2026-11-11T12:00:05Z',
					},
				}),
	);
	await page.route(`**${path}/artifacts/${png}*`, route =>
		route.fulfill({
			contentType: 'image/png',
			body: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
				'base64',
			),
		}),
	);
	await page.route(`**${path}/artifacts/${csv}/preview`, route =>
		route.fulfill({
			json: {
				kind: 'table',
				headers: ['Duration_s'],
				rows: [['42']],
				truncated: false,
			},
		}),
	);
	await page.route(`**${path}/artifacts/${script}/preview`, route =>
		route.fulfill({
			json: { kind: 'text', text: 'print(42)', truncated: false },
		}),
	);
	await page.route(`**${path}/artifacts/${csv}`, route =>
		route.fulfill({
			contentType: 'text/csv',
			headers: { 'Content-Disposition': 'attachment; filename=summary.csv' },
			body: 'Duration_s\n42\n',
		}),
	);
	await page.goto(
		`/projects/${project.id}/agents/${agent.id}/playground?execution=${runId}`,
	);
	await expect(page.getByText('Files temporarily unavailable.')).toBeVisible();
	unavailable = false;
	await page.getByRole('button', { name: 'Refresh generated files' }).click();
	await expect(
		page.getByRole('img', { name: 'Generated chart: duration.png' }),
	).toBeVisible();
	await page.getByRole('button', { name: 'Preview duration.png' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(
		page.getByRole('button', { name: 'Preview duration.png' }),
	).toBeFocused();
	await page.getByRole('button', { name: 'Preview summary.csv' }).click();
	await expect(
		page.getByRole('dialog').getByRole('cell', { name: '42', exact: true }),
	).toBeVisible();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	const downloading = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Download summary.csv' }).click();
	expect((await downloading).suggestedFilename()).toBe('summary.csv');
	await page.getByText('Executed Python · 1 script').click();
	await page
		.getByRole('button', { name: 'Preview analysis_step_01.py' })
		.click();
	await expect(page.getByRole('dialog')).toContainText('print(42)');
	await page.keyboard.press('Escape');
	await expect(
		page.getByRole('link', { name: 'Download old.txt' }),
	).toHaveCount(0);
	await page.reload();
	await expect(
		page.getByRole('button', { name: 'Preview summary.csv' }),
	).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
});
