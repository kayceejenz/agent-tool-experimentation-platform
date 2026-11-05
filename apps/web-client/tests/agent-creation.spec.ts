import { expect } from '@playwright/test';
import { test, ORIGIN } from './fixtures';

test('create and enable a dataset agent with no custom prompts or MCP tools', async ({
	page,
	context,
}) => {
	const response = await context.request.post('/api/projects', {
		headers: { Origin: ORIGIN },
		data: { name: 'Simple analysis' },
	});
	expect(response.status()).toBe(201);
	const project = await response.json();
	await page.goto(`/projects/${project.id}/agents`);
	await page.getByRole('link', { name: 'Create agent', exact: true }).click();
	const form = page.getByRole('region', {
		name: 'Agent configuration',
		exact: true,
	});
	await expect(
		form.getByRole('button', { name: 'Next', exact: true }),
	).toHaveCount(0);
	await expect(
		form.getByRole('combobox', { name: 'System prompt', exact: true }),
	).not.toBeVisible();
	await expect(
		form.getByRole('combobox', { name: 'Agent prompt', exact: true }),
	).not.toBeVisible();
	await form.getByLabel('Name', { exact: true }).fill('Dataset analyst');
	await form
		.getByRole('combobox', { name: 'Model', exact: true })
		.selectOption('gpt-4.1-mini');
	await form.getByRole('button', { name: 'Create agent', exact: true }).click();
	await expect(page).toHaveURL(/agents\/[0-9a-f-]{36}$/);
	const id = page.url().split('/').pop();
	const saved = await (
		await context.request.get(`/api/projects/${project.id}/agents/${id}`)
	).json();
	expect(saved.configuration_ready).toBe(true);
	expect(saved.system_prompt).toBeNull();
	expect(saved.agent_prompt).toBeNull();
	expect(saved.tools).toEqual([]);
	expect(saved.evaluation_profile.enabled).toBe(false);
	await page.reload();
	await page
		.getByRole('button', { name: 'Enable and open playground', exact: true })
		.click();
	await expect(page).toHaveURL(/\/playground$/);
	await expect(
		page.getByRole('combobox', { name: 'Dataset Optional' }),
	).toBeVisible();
});
