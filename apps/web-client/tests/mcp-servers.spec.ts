import { expect } from '@playwright/test';
import { test, ORIGIN } from './fixtures';

async function project(
	request: import('@playwright/test').APIRequestContext,
	name = 'MCP workspace',
) {
	const response = await request.post('/api/projects', {
		headers: { Origin: ORIGIN },
		data: { name },
	});
	expect(response.status()).toBe(201);
	return response.json();
}

async function add(
	page: import('@playwright/test').Page,
	name: string,
	token = '',
	endpoint = 'http://localhost:8012/mcp',
) {
	await page
		.getByRole('button', { name: 'Add server', exact: true })
		.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Server name', { exact: true }).fill(name);
	await dialog.getByLabel('Endpoint URL').fill(endpoint);
	if (token) {
		await dialog
			.getByLabel('Authentication', { exact: true })
			.selectOption('bearer');
		await dialog
			.getByLabel('Bearer token', { exact: true })
			.fill(token);
	}
	await dialog
		.getByRole('button', { name: 'Add server', exact: true })
		.click();
	await expect(dialog).not.toBeVisible();
}

test('manage a real connection without exposing stored tokens', async ({
	page,
	context,
}) => {
	const data = await project(context.request);
	await page.goto(`/projects/${data.id}/servers`);
	await expect(
		page.getByRole('heading', { name: 'No MCP servers yet' }),
	).toBeVisible();
	await add(page, 'Demo MCP', 'test-only-private-token');
	const row = page.getByRole('row', {
		name: 'Demo MCP',
		exact: true,
	});
	await expect(row).toContainText('Not checked');
	await expect(row).toContainText('Configured');
	await expect(row.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'false',
	);
	await row.getByRole('switch').click();
	await expect(row.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'true',
	);
	await row.getByRole('button', { name: 'Manage Demo MCP' }).click();
	const panel = page.locator('dialog.mcp-sheet');
	await expect(
		panel.getByRole('heading', { name: 'Overview' }),
	).toBeVisible();
	await panel.getByRole('button', { name: 'Edit connection' }).click();
	await expect(panel.getByLabel('Replacement bearer token')).toHaveValue(
		'',
	);
	await panel
		.getByLabel('Server name', { exact: true })
		.fill('Renamed MCP');
	await panel.getByRole('button', { name: 'Save connection' }).click();
	await expect(
		panel.getByRole('heading', { name: 'Renamed MCP' }),
	).toBeVisible();
	await expect(panel.getByRole('status')).toContainText(
		'Connection saved.',
	);
	const renamed = page.getByRole('row', {
		name: 'Renamed MCP',
		exact: true,
	});
	await expect(renamed.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'true',
	);
	await panel.getByRole('button', { name: 'Edit connection' }).click();
	await panel
		.getByLabel('Endpoint URL')
		.fill('http://localhost:8012/updated');
	await expect(
		panel.getByLabel('Replacement bearer token'),
	).toHaveAttribute('required', '');
	await panel
		.getByLabel('Replacement bearer token')
		.fill('test-only-replacement');
	await panel.getByRole('button', { name: 'Save connection' }).click();
	await expect(panel.getByRole('status')).toContainText(
		'Connection saved.',
	);
	await expect(renamed.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'false',
	);
	await page.screenshot({
		path: 'test-results/mcp-manage-panel.png',
	});
	await page.keyboard.press('Escape');
	await expect(panel).not.toBeVisible();
	await page.reload();
	await expect(renamed).toContainText('http://localhost:8012/updated');
	const response = await context.request.get(
		`/api/projects/${data.id}/mcp-servers`,
	);
	const body = await response.text();
	expect(body).not.toContain('test-only-private-token');
	expect(body).not.toContain('test-only-replacement');
	expect(body).not.toContain('encrypted_value');
	await page.screenshot({
		path: 'test-results/mcp-servers-desktop.png',
		fullPage: true,
	});
	await renamed
		.getByRole('button', { name: 'Manage Renamed MCP' })
		.click();
	const reopened = panel;
	await reopened.getByRole('button', { name: 'Edit connection' }).click();
	await reopened
		.getByLabel('Authentication', { exact: true })
		.selectOption('none');
	await expect(reopened).toContainText('remove the stored token');
	await reopened.getByRole('button', { name: 'Save connection' }).click();
	await expect(reopened.getByRole('status')).toContainText(
		'Connection saved.',
	);
	await expect(renamed).toContainText('None');
});

test('forms support mobile, keyboard dismissal, failure recovery, and denied writes', async ({
	page,
	context,
}) => {
	const data = await project(context.request);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/projects/${data.id}/servers`);
	const addButton = page.getByRole('button', {
		name: 'Add server',
		exact: true,
	});
	await addButton.click();
	await expect(
		page.getByLabel('Server name', { exact: true }),
	).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(addButton).toBeFocused();
	await addButton.click();
	const dialog = page.getByRole('dialog');
	await dialog
		.getByLabel('Server name', { exact: true })
		.fill('Retained name');
	await dialog
		.getByLabel('Endpoint URL')
		.fill('http://localhost:8012/mcp');
	await page.route(`**/api/projects/${data.id}/mcp-servers`, route =>
		route.request().method() === 'POST'
			? route.fulfill({
					status: 503,
					json: { error: 'Please retry saving.' },
				})
			: route.continue(),
	);
	await dialog
		.getByRole('button', { name: 'Add server', exact: true })
		.click();
	await expect(dialog.getByRole('alert')).toContainText(
		'Please retry saving.',
	);
	await expect(
		dialog.getByLabel('Server name', { exact: true }),
	).toHaveValue('Retained name');
	await page.screenshot({
		path: 'test-results/mcp-form-mobile.png',
		fullPage: true,
	});
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				innerWidth,
		),
	).toBe(true);
	await page.unroute(`**/api/projects/${data.id}/mcp-servers`);
	await dialog
		.getByRole('button', { name: 'Add server', exact: true })
		.click();
	await expect(dialog).not.toBeVisible();
	await page
		.getByRole('row', { name: 'Retained name' })
		.getByRole('button', { name: 'Manage Retained name' })
		.click();
	const panel = page.locator('dialog.mcp-sheet');
	await expect(
		panel.getByRole('heading', { name: 'Retained name' }),
	).toBeVisible();
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				innerWidth,
		),
	).toBe(true);
	await panel.getByRole('button', { name: 'Edit connection' }).click();
	await page.route(`**/api/projects/${data.id}/mcp-servers/*`, route =>
		route.fulfill({
			status: 403,
			json: {
				error: 'You no longer have permission to manage MCP connections.',
			},
		}),
	);
	await panel.getByRole('button', { name: 'Save connection' }).click();
	await expect(panel.getByRole('alert')).toContainText(
		'no longer have permission',
	);
	await expect(
		panel.getByRole('button', { name: 'Save connection' }),
	).toBeDisabled();
	await panel.getByRole('button', { name: 'Cancel' }).click();
	await expect(panel).toContainText('read-only access');
	await expect(
		panel.getByRole('button', { name: 'Edit connection' }),
	).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(panel).not.toBeVisible();
	await expect(addButton).toHaveCount(0);
});

test('list failures can retry and pagination remains scoped to the selected project', async ({
	page,
	context,
}) => {
	const first = await project(context.request);
	const second = await project(context.request, 'Another workspace');
	const base = `/api/projects/${first.id}/mcp-servers`;
	for (let index = 0; index < 21; index++) {
		const response = await context.request.post(base, {
			headers: { Origin: ORIGIN },
			data: {
				name: `Connection ${index}`,
				endpoint: 'http://localhost:8012/mcp',
			},
		});
		expect(response.status()).toBe(201);
	}
	await page.route(`**${base}*`, route =>
		route.fulfill({
			status: 503,
			json: { error: 'Connections unavailable.' },
		}),
	);
	await page.goto(`/projects/${first.id}/servers`);
	await expect(page.getByRole('main').getByRole('alert')).toContainText(
		'Connections unavailable.',
	);
	await page.unroute(`**${base}*`);
	await page.getByRole('button', { name: 'Try again' }).click();
	await expect(page.locator('.mcp-table tbody tr')).toHaveCount(20);
	await page.getByRole('button', { name: 'Load more servers' }).click();
	await expect(page.locator('.mcp-table tbody tr')).toHaveCount(21);
	await page.getByLabel('Switch project').selectOption(second.id);
	await expect(page).toHaveURL(
		new RegExp(`/projects/${second.id}/servers$`),
	);
	await expect(
		page.getByRole('heading', { name: 'No MCP servers yet' }),
	).toBeVisible();
	await expect(page.locator('.mcp-table tbody tr')).toHaveCount(0);
});

test('connection routes reject forged origins and cross-project IDs', async ({
	context,
}) => {
	const first = await project(context.request);
	const second = await project(context.request);
	const base = `/api/projects/${first.id}/mcp-servers`;
	const created = await context.request.post(base, {
		headers: { Origin: ORIGIN },
		data: {
			name: 'Private connection',
			endpoint: 'http://localhost:8012/mcp',
		},
	});
	expect(created.status()).toBe(201);
	const id = (await created.json()).id;
	expect(
		(
			await context.request.get(
				`/api/projects/${second.id}/mcp-servers/${id}`,
			)
		).status(),
	).toBe(404);
	expect(
		(
			await context.request.post(base, {
				headers: { Origin: 'https://foreign.example' },
				data: {
					name: 'Forged',
					endpoint: 'http://localhost:8012/mcp',
				},
			})
		).status(),
	).toBe(403);
	expect(
		(
			await context.request.patch(`${base}/${id}`, {
				headers: { Origin: 'https://foreign.example' },
				data: { enabled: true },
			})
		).status(),
	).toBe(403);
});

test('check a live MCP connection and discover tool schemas', async ({
	page,
	context,
}) => {
	const data = await project(context.request);
	await page.goto(`/projects/${data.id}/servers`);
	await add(page, 'Retail analysis', '', 'http://127.0.0.1:8013/mcp');
	const row = page.getByRole('row', {
		name: 'Retail analysis',
		exact: true,
	});
	await row
		.getByRole('button', { name: 'Manage Retail analysis' })
		.click();
	const panel = page.locator('dialog.mcp-sheet');
	await expect(
		panel.getByRole('heading', { name: 'Retail analysis' }),
	).toBeVisible();
	await panel.getByRole('button', { name: 'Check connection' }).click();
	await expect(panel.getByRole('status')).toContainText(
		'responded successfully',
	);
	await expect(row.getByText('Connected', { exact: true })).toBeVisible();
	await expect(row.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'false',
	);
	await panel.getByRole('button', { name: 'Discover' }).click();
	await expect(
		panel.getByRole('heading', { name: /^Tools/ }),
	).toBeVisible();
	await expect(panel.getByRole('status')).toContainText(
		'tools discovered',
	);
	await panel.locator('summary', { hasText: 'inspect_dataset' }).click();
	await expect(panel.locator('details[open] pre')).toContainText(
		'dataset_id',
	);
	await page.screenshot({
		path: 'test-results/mcp-manage-tools.png',
	});
	await page.keyboard.press('Escape');
	await expect(panel).not.toBeVisible();
	await page.reload();
	await expect(row.getByText('Connected', { exact: true })).toBeVisible();
	const id = (
		await (
			await context.request.get(
				`/api/projects/${data.id}/mcp-servers`,
			)
		).json()
	).items[0].id;
	expect(
		(
			await context.request.post(
				`/api/projects/${data.id}/mcp-servers/${id}/check`,
				{
					headers: {
						Origin: 'https://untrusted.example',
					},
					data: {},
				},
			)
		).status(),
	).toBe(403);
});
