import { expect } from '@playwright/test';
import { test, ORIGIN } from './fixtures';

test('discover, enable, execute and reopen persisted tool tests', async ({
	page,
	context,
}) => {
	const headers = { Origin: ORIGIN };
	const project = await (
		await context.request.post('/api/projects', {
			headers,
			data: { name: 'Tool testing' },
		})
	).json();
	const base = `/api/projects/${project.id}`;
	const server = await (
		await context.request.post(`${base}/mcp-servers`, {
			headers,
			data: {
				name: 'Ecommerce demo',
				endpoint: 'http://127.0.0.1:8013/mcp',
			},
		})
	).json();
	const discovery = await context.request.post(
		`${base}/mcp-servers/${server.id}/discover`,
		{ headers, data: {} },
	);
	expect(discovery.ok()).toBeTruthy();
	expect((await discovery.json()).tools).toHaveLength(15);
	await context.request.patch(`${base}/mcp-servers/${server.id}`, {
		headers,
		data: { enabled: true },
	});
	await page.goto(`/projects/${project.id}/tools`);
	await expect(
		page.getByRole('heading', { name: 'Tools', exact: true }),
	).toBeVisible();
	const row = page
		.getByRole('row')
		.filter({
			has: page.getByText('describe_store', { exact: true }),
		});
	await expect(row.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'false',
	);
	await row.getByRole('switch').click();
	await expect(row.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'true',
	);
	await page.reload();
	await expect(row.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'true',
	);
	await row.getByRole('button', { name: 'Manage' }).click();
	const dialog = page.getByRole('dialog');
	await expect(
		dialog.getByRole('button', { name: 'Run tool', exact: true }),
	).toBeDisabled();
	await dialog.getByRole('checkbox').check();
	await dialog
		.getByRole('button', { name: 'Run tool', exact: true })
		.click();
	await expect(
		dialog.getByRole('heading', {
			name: 'Test result',
			exact: true,
		}),
	).toBeVisible();
	await expect(dialog.locator('.tool-result-meta').first()).toContainText(
		'success',
	);
	await page.screenshot({
		path: 'test-results/tool-test-desktop.png',
		fullPage: true,
	});
	await page.keyboard.press('Escape');
	await page.reload();
	await row.getByRole('button', { name: 'Manage' }).click();
	await expect(page.locator('.tool-history')).toHaveCount(1);
	await page.locator('.tool-history > summary').click();
	await expect(
		page.locator('.tool-history .tool-result-meta'),
	).toContainText('success');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({
		path: 'test-results/tool-test-mobile.png',
		fullPage: true,
	});
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				innerWidth,
		),
	).toBeTruthy();
	await page.keyboard.press('Escape');
	await row.getByRole('switch').click();
	await expect(row.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'false',
	);
	await row.getByRole('button', { name: 'Manage' }).click();
	await expect(page.getByRole('dialog')).toContainText(
		'Enable this tool and its MCP server',
	);
});
