import { expect } from '@playwright/test';
import { test, ORIGIN } from './fixtures';

test('create prompts, preserve revisions, filter types and recover from stale edits', async ({
	page,
	context,
}) => {
	const project = await (
		await context.request.post('/api/projects', {
			headers: { Origin: ORIGIN },
			data: { name: 'Prompt workspace' },
		})
	).json();
	const base = `/api/projects/${project.id}/prompts`;
	await page.goto(`/projects/${project.id}/prompts`);
	await expect(
		page.getByRole('heading', { name: 'No prompts yet' }),
	).toBeVisible();
	await page
		.getByRole('button', { name: 'Create prompt', exact: true })
		.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name', { exact: true }).fill('Commerce rules');
	await dialog.getByRole('combobox').selectOption('system');
	await dialog
		.getByLabel('Description')
		.fill('Shared ecommerce instructions');
	await dialog
		.getByLabel('Instructions')
		.fill('Use GBP.\nNever invent prices.');
	await dialog
		.getByRole('button', { name: 'Create prompt', exact: true })
		.click();
	await expect(dialog.getByRole('status')).toContainText(
		'Revision 1 saved.',
	);
	await dialog
		.getByLabel('Instructions')
		.fill('Use GBP.\nConfirm invoice details.');
	await dialog.getByRole('button', { name: 'Save new revision' }).click();
	await expect(dialog.getByRole('status')).toContainText(
		'Revision 2 saved.',
	);
	await dialog.getByRole('button', { name: 'Revision history' }).click();
	await dialog
		.getByRole('button', { name: 'View revision 1', exact: true })
		.click();
	await expect(dialog.locator('.prompt-preview')).toContainText(
		'Never invent prices.',
	);
	await expect(dialog.locator('.prompt-preview')).not.toContainText(
		'Confirm invoice details.',
	);
	await page.screenshot({
		path: 'test-results/prompt-history-desktop.png',
	});
	await page.keyboard.press('Escape');
	await page.reload();
	await expect(
		page.getByRole('row').filter({ hasText: 'Commerce rules' }),
	).toContainText('v2');
	const prompt = (await (await context.request.get(base)).json())
		.items[0];
	await page
		.getByRole('button', { name: 'Manage Commerce rules' })
		.click();
	await expect(dialog.getByLabel('Instructions')).toHaveValue(
		'Use GBP.\nConfirm invoice details.',
	);
	await context.request.post(`${base}/${prompt.id}/revisions`, {
		headers: { Origin: ORIGIN },
		data: {
			name: 'Commerce rules',
			description: 'Updated elsewhere',
			content: 'Another edit',
			base_revision: 2,
		},
	});
	await dialog.getByLabel('Instructions').fill('Keep my local edit');
	await dialog.getByRole('button', { name: 'Save new revision' }).click();
	await expect(dialog.getByRole('alert')).toContainText('newer revision');
	await expect(dialog.getByLabel('Instructions')).toHaveValue(
		'Keep my local edit',
	);
	await page.keyboard.press('Escape');
	await expect(dialog).toContainText('unsaved changes');
	await dialog.getByRole('button', { name: 'Discard changes' }).click();
	for (const type of ['agent', 'evaluation']) {
		const response = await context.request.post(base, {
			headers: { Origin: ORIGIN },
			data: {
				name: `${type} prompt`,
				type,
				content: 'Instructions',
			},
		});
		expect(response.status()).toBe(201);
	}
	await page.getByLabel('Prompt type').selectOption('evaluation');
	await expect(
		page.getByRole('row').filter({ hasText: 'evaluation prompt' }),
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Manage Commerce rules' }),
	).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	await page
		.getByRole('button', { name: 'Manage evaluation prompt' })
		.click();
	await expect(dialog.getByLabel('Instructions')).toHaveValue(
		'Instructions',
	);
	await page.screenshot({
		path: 'test-results/prompt-editor-mobile.png',
	});
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				innerWidth,
		),
	).toBeTruthy();
	expect(
		(
			await context.request.post(base, {
				headers: { Origin: 'https://foreign.example' },
				data: {
					name: 'Blocked',
					type: 'agent',
					content: 'x',
				},
			})
		).status(),
	).toBe(403);
});
