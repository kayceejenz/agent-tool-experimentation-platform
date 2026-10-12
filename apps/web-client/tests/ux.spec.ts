import { expect } from '@playwright/test';
import { test, ORIGIN } from './fixtures';

test('overview reflects setup and dedicated agent pages survive reload without mobile overflow', async ({
	page,
	context,
}) => {
	const headers = { Origin: ORIGIN };
	const project = await (
		await context.request.post('/api/projects', {
			headers,
			data: { name: 'Accessible workspace' },
		})
	).json();
	const base = `/api/projects/${project.id}`;
	await page.goto(`/projects/${project.id}`);
	await expect(
		page.getByRole('heading', { name: 'Your next step' }),
	).toBeVisible();
	await expect(
		page
			.getByRole('link', {
				name: 'Connect a server',
				exact: true,
			})
			.first(),
	).toBeVisible();
	const refs: Record<string, { id: string; revision: number }> = {};
	for (const type of ['system', 'agent']) {
		const prompt = await (
			await context.request.post(`${base}/prompts`, {
				headers,
				data: {
					name: `${type} instructions`,
					type,
					content: 'Use the available tools and evidence.',
				},
			})
		).json();
		refs[`${type}_prompt`] = { id: prompt.id, revision: 1 };
	}
	const agent = await (
		await context.request.post(`${base}/agents`, {
			headers,
			data: {
				name: 'Accessible agent',
				...refs,
				model_settings: {
					provider: 'openai',
					model: 'gpt-4o-mini',
				},
			},
		})
	).json();
	await page.screenshot({ path: 'test-results/project-overview.png' });
	await page.goto(`/projects/${project.id}/agents/${agent.id}`);
	await expect(
		page.getByRole('region', { name: 'Agent configuration' }),
	).toBeVisible();
	await page
		.getByRole('textbox', { name: 'Description', exact: true })
		.fill('Unsaved description');
	await page
		.getByRole('navigation', { name: 'Breadcrumb' })
		.getByRole('link', { name: 'Agents', exact: true })
		.click();
	await expect(
		page
			.getByRole('alert')
			.filter({ hasText: 'You have unsaved changes.' }),
	).toContainText('unsaved changes');
	await expect(
		page.getByRole('button', { name: 'Keep editing', exact: true }),
	).toBeFocused();
	await page
		.getByRole('button', { name: 'Keep editing', exact: true })
		.click();
	await expect(
		page.getByRole('textbox', { name: 'Description', exact: true }),
	).toHaveValue('Unsaved description');
	await page
		.getByRole('textbox', { name: 'Description', exact: true })
		.fill('');
	await expect(
		page.getByRole('button', {
			name: 'Enable and open playground',
		}),
	).toBeVisible();
	await page
		.getByRole('button', { name: 'Enable and open playground' })
		.click();
	await expect(page).toHaveURL(new RegExp(`${agent.id}/playground$`));
	await page.reload();
	await expect(
		page.getByRole('region', { name: 'Agent playground' }),
	).toBeVisible();
	await page
		.getByRole('textbox', { name: 'Task', exact: true })
		.fill('A task retained while using this page.');
	await page.setViewportSize({ width: 320, height: 800 });
	await expect(
		page.getByRole('button', { name: 'Run task' }),
	).toBeVisible();
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				window.innerWidth,
		),
	).toBeTruthy();
	await page.getByRole('button', { name: 'Back to agents' }).click();
	await expect(
		page.getByRole('row').filter({ hasText: 'Accessible agent' }),
	).toBeVisible();
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				window.innerWidth,
		),
	).toBeTruthy();
});

test('nested tool fields resolve local schema references and raw JSON errors are associated with inputs', async ({
	page,
	context,
}) => {
	const headers = { Origin: ORIGIN };
	const project = await (
		await context.request.post('/api/projects', {
			headers,
			data: { name: 'Structured tool forms' },
		})
	).json();
	const base = `/api/projects/${project.id}`;
	const server = await (
		await context.request.post(`${base}/mcp-servers`, {
			headers,
			data: {
				name: 'Demo',
				endpoint: 'http://127.0.0.1:8013/mcp',
			},
		})
	).json();
	await context.request.post(
		`${base}/mcp-servers/${server.id}/discover`,
		{ headers, data: {} },
	);
	await context.request.patch(`${base}/mcp-servers/${server.id}`, {
		headers,
		data: { enabled: true },
	});
	const catalog = await (
		await context.request.get(`${base}/tools`)
	).json();
	const tool = catalog.items.find(
		(item: { name: string }) =>
			item.name === 'create_draft_invoice',
	);
	await context.request.patch(`${base}/tools/${tool.id}`, {
		headers,
		data: { enabled: true, revision: tool.revision },
	});
	await page.goto(`/projects/${project.id}/tools`);
	await page
		.getByRole('row')
		.filter({
			has: page.getByText('create_draft_invoice', {
				exact: true,
			}),
		})
		.getByRole('button', { name: 'Manage' })
		.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: /Add item to/i }).click();
	const item = dialog.getByRole('group', { name: /LineItem/ });
	await item.getByRole('textbox').fill('P001');
	await item.getByRole('spinbutton').fill('2');
	await dialog
		.getByRole('button', { name: 'Advanced JSON', exact: true })
		.click();
	const raw = dialog.getByRole('textbox', {
		name: 'Arguments (JSON object)',
	});
	await expect(raw).toHaveValue(/"quantity": 2/);
	await raw.fill('{ invalid');
	await expect(raw).toHaveAttribute('aria-invalid', 'true');
	const described = await raw.getAttribute('aria-describedby');
	expect(described).toBeTruthy();
	await expect(dialog.locator(`[id="${described}"]`)).toContainText(
		'valid JSON object',
	);
	await page.screenshot({
		path: 'test-results/structured-input-error.png',
	});
});
