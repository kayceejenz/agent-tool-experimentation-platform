import { expect } from '@playwright/test';
import { test, ORIGIN } from './fixtures';

test('configure agents, pin prompts, preserve history and reset availability on edits', async ({
	page,
	context,
}) => {
	const project = await (
		await context.request.post('/api/projects', {
			headers: { Origin: ORIGIN },
			data: { name: 'Agent workspace' },
		})
	).json();
	const refs: Record<string, string> = {};
	for (const type of ['system', 'agent', 'evaluation']) {
		const result = await context.request.post(
			`/api/projects/${project.id}/prompts`,
			{
				headers: { Origin: ORIGIN },
				data: {
					name: `${type} rules`,
					type,
					content: `Original ${type} instructions`,
				},
			},
		);
		expect(result.status()).toBe(201);
		refs[type] = (await result.json()).id;
	}
	const headers = { Origin: ORIGIN };
	const base = `/api/projects/${project.id}`;
	const server = await (
		await context.request.post(`${base}/mcp-servers`, {
			headers,
			data: { name: 'Ecommerce', endpoint: 'http://127.0.0.1:8013/mcp' },
		})
	).json();
	expect(
		(
			await context.request.post(`${base}/mcp-servers/${server.id}/discover`, {
				headers,
				data: {},
			})
		).ok(),
	).toBeTruthy();
	await context.request.patch(`${base}/mcp-servers/${server.id}`, {
		headers,
		data: { enabled: true },
	});
	const catalog = await (await context.request.get(`${base}/tools`)).json();
	const tool = catalog.items.find(
		(item: { name: string }) => item.name === 'describe_store',
	);
	await context.request.patch(`${base}/tools/${tool.id}`, {
		headers,
		data: { enabled: true, revision: tool.revision },
	});
	await page.goto(`/projects/${project.id}/agents`);
	await page.getByRole('button', { name: 'Create agent', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name', { exact: true }).fill('Commerce analyst');
	await dialog.getByRole('button', { name: 'Next', exact: true }).click();
	await dialog
		.getByRole('combobox', { name: 'System prompt', exact: true })
		.selectOption(refs.system);
	await expect(
		dialog.getByRole('combobox', {
			name: 'System prompt revision',
			exact: true,
		}),
	).toHaveValue('1');
	await dialog
		.getByRole('combobox', { name: 'Agent prompt', exact: true })
		.selectOption(refs.agent);
	await expect(
		dialog.getByRole('combobox', {
			name: 'Agent prompt revision',
			exact: true,
		}),
	).toHaveValue('1');
	await dialog.getByRole('button', { name: 'Next', exact: true }).click();
	await dialog.getByLabel('Provider', { exact: true }).fill('example');
	await dialog.getByLabel('Model identifier').fill('demo');
	await dialog.getByRole('button', { name: 'Next', exact: true }).click();
	await dialog.getByRole('checkbox', { name: /describe_store/ }).check();
	await dialog.getByRole('button', { name: 'Next', exact: true }).click();
	await dialog.getByRole('button', { name: 'Create agent', exact: true }).click();
	await expect(dialog.getByRole('status')).toContainText('Revision 1 saved.');
	await dialog.getByRole('button', { name: 'Details', exact: true }).click();
	await dialog.getByRole('switch').click();
	await expect(dialog.getByRole('switch')).toBeChecked();
	await dialog.getByLabel('Description').fill('Revised description');
	await dialog.getByRole('button', { name: 'Save new revision' }).click();
	await expect(dialog.getByRole('status')).toContainText('Revision 2 saved.');
	await expect(dialog.getByRole('switch')).not.toBeChecked();
	await dialog.getByRole('button', { name: 'History', exact: true }).click();
	await dialog
		.getByRole('button', { name: 'View revision 1', exact: true })
		.click();
	await expect(dialog.locator('.agent-preview')).toContainText(
		'Original system instructions',
	);
	await dialog
		.getByRole('button', { name: 'View revision 2', exact: true })
		.click();
	await expect(dialog.locator('.agent-preview')).toContainText('demo');
	await page.keyboard.press('Escape');
	await page.reload();
	await expect(
		page.getByRole('row').filter({ hasText: 'Commerce analyst' }),
	).toContainText('v2');
	await page.getByRole('button', { name: 'Manage Commerce analyst' }).click();
	await dialog.getByRole('button', { name: 'Prompts', exact: true }).click();
	await expect(
		dialog.getByRole('combobox', { name: 'System prompt', exact: true }),
	).toHaveValue(refs.system);
	await page.screenshot({ path: 'test-results/agent-prompts-desktop.png' });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(
		dialog.getByRole('button', { name: 'Close', exact: true }),
	).toBeVisible();
	await page.screenshot({ path: 'test-results/agent-prompts-mobile.png' });
});
