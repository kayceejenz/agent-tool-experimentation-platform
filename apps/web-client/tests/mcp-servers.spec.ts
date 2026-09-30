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
) {
	await page
		.getByRole('button', { name: 'Add server', exact: true })
		.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Server name', { exact: true }).fill(name);
	await dialog
		.getByLabel('Endpoint URL')
		.fill('http://localhost:8012/mcp');
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
	const row = page.getByRole('article', {
		name: 'Demo MCP',
		exact: true,
	});
	await expect(row).toContainText('Not checked');
	await expect(row).toContainText('Bearer token · Configured');
	await expect(row.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'false',
	);
	await row.getByRole('switch').click();
	await expect(row.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'true',
	);
	await row.getByRole('button', { name: 'Edit', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('Replacement bearer token')).toHaveValue(
		'',
	);
	await dialog
		.getByLabel('Server name', { exact: true })
		.fill('Renamed MCP');
	await dialog.getByRole('button', { name: 'Save connection' }).click();
	await expect(dialog).not.toBeVisible();
	const renamed = page.getByRole('article', {
		name: 'Renamed MCP',
		exact: true,
	});
	await expect(renamed.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'true',
	);
	await renamed
		.getByRole('button', { name: 'Edit', exact: true })
		.click();
	await dialog
		.getByLabel('Endpoint URL')
		.fill('http://localhost:8012/updated');
	await expect(
		dialog.getByLabel('Replacement bearer token'),
	).toHaveAttribute('required', '');
	await dialog
		.getByLabel('Replacement bearer token')
		.fill('test-only-replacement');
	await dialog.getByRole('button', { name: 'Save connection' }).click();
	await expect(dialog).not.toBeVisible();
	await expect(renamed.getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'false',
	);
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
		.getByRole('button', { name: 'Edit', exact: true })
		.click();
	await dialog
		.getByLabel('Authentication', { exact: true })
		.selectOption('none');
	await expect(dialog).toContainText('remove the stored token');
	await dialog.getByRole('button', { name: 'Save connection' }).click();
	await expect(dialog).not.toBeVisible();
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
		.getByRole('article', { name: 'Retained name' })
		.getByRole('button', { name: 'Edit', exact: true })
		.click();
	await page.route(`**/api/projects/${data.id}/mcp-servers/*`, route =>
		route.fulfill({
			status: 403,
			json: {
				error: 'You no longer have permission to manage MCP connections.',
			},
		}),
	);
	await dialog.getByRole('button', { name: 'Save connection' }).click();
	await expect(dialog.getByRole('alert')).toContainText(
		'no longer have permission',
	);
	await expect(
		dialog.getByRole('button', { name: 'Save connection' }),
	).toBeDisabled();
	await dialog.getByRole('button', { name: 'Cancel' }).click();
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
	await expect(page.getByRole('article')).toHaveCount(20);
	await page.getByRole('button', { name: 'Load more servers' }).click();
	await expect(page.getByRole('article')).toHaveCount(21);
	await page.getByLabel('Switch project').selectOption(second.id);
	await expect(page).toHaveURL(
		new RegExp(`/projects/${second.id}/servers$`),
	);
	await expect(
		page.getByRole('heading', { name: 'No MCP servers yet' }),
	).toBeVisible();
	await expect(page.getByRole('article')).toHaveCount(0);
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
