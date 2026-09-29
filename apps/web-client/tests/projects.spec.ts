import { expect } from '@playwright/test';
import { test, ORIGIN } from './fixtures';

async function createProject(request: import('@playwright/test').APIRequestContext, name: string) {
	const response = await request.post('/api/projects', { headers: { Origin: ORIGIN }, data: { name, description: 'Project test' } });
	expect(response.status()).toBe(201);
	return response.json();
}

test('create, edit, refresh login, and switch real projects', async ({ page, context }) => {
	await page.goto('/projects');
	await page.getByRole('link', { name: 'Create project', exact: true }).first().click();
	await page.getByLabel('Project name', { exact: true }).fill('First agent project');
	await page.getByLabel('Description', { exact: false }).fill('Evaluate support tasks.');
	await page.getByRole('button', { name: 'Create project', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'First agent project', exact: true })).toBeVisible();
	const first = page.url();
	await page.getByRole('navigation', { name: 'Project pages' }).getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByLabel('Project name', { exact: true }).fill('Renamed agent project');
	await page.getByLabel('Description', { exact: false }).fill('');
	await context.clearCookies({ name: 'agent_access_token' });
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await expect(page.getByRole('status')).toHaveText('Project saved.');
	await page.reload();
	await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Renamed agent project');
	await expect(page.getByLabel('Description', { exact: false })).toHaveValue('');
	const second = await createProject(context.request, 'Second project');
	await page.reload();
	await expect(page.getByLabel('Switch project').locator('option')).toHaveCount(2);
	await page.getByLabel('Switch project').selectOption(second.id);
	await expect(page).toHaveURL(new RegExp(`/projects/${second.id}/settings$`));
	await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Second project');
	await page.goto(first);
	await expect(page.getByRole('heading', { name: 'Renamed agent project', exact: true })).toBeVisible();
	await page.screenshot({ path: 'test-results/project-overview.png', fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(first + '/settings');
	await page.screenshot({ path: 'test-results/project-settings-mobile.png', fullPage: true });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('load errors and save errors retain input and offer retry', async ({ page, context }) => {
	await page.route('**/api/projects', route => route.request().method() === 'GET' ? route.fulfill({ status: 503, json: { error: 'Projects unavailable.' } }) : route.continue());
	await page.goto('/projects');
	await expect(page.getByRole('main').getByRole('alert')).toContainText('Projects unavailable.');
	await page.unroute('**/api/projects');
	await page.getByRole('button', { name: 'Try again' }).click();
	await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
	const project = await createProject(context.request, 'Editable');
	await page.goto(`/projects/${project.id}/settings`);
	await page.route(`**/api/projects/${project.id}`, route => route.fulfill({ status: 503, json: { error: 'Please retry saving.' } }));
	await page.getByLabel('Project name', { exact: true }).fill('Retained input');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('main').getByRole('alert')).toContainText('Please retry saving.');
	await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Retained input');
	await page.unroute(`**/api/projects/${project.id}`);
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('status')).toHaveText('Project saved.');
});

test('denied writes disable editing without discarding entered details', async ({ page, context }) => {
	const project = await createProject(context.request, 'Restricted');
	await page.goto(`/projects/${project.id}/settings`);
	await page.route(`**/api/projects/${project.id}`, route => route.fulfill({ status: 403, json: { error: 'You no longer have permission to edit this project.' } }));
	await page.getByLabel('Project name', { exact: true }).fill('Unsaved name');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('main').getByRole('alert')).toContainText('no longer have permission');
	await expect(page.getByLabel('Project name', { exact: true })).toBeDisabled();
	await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Unsaved name');
});

test('project routes enforce authentication, origin, and membership', async ({ context, browser }) => {
	const project = await createProject(context.request, 'Private project');
	const foreign = await browser.newContext();
	try {
		expect((await foreign.request.get(`${ORIGIN}/api/projects/${project.id}`)).status()).toBe(401);
		const headers = { Origin: ORIGIN, 'X-Test-Client-IP': '192.0.2.240' };
		const credentials = { email: `outsider-${project.id}@example.com`, password: 'outsider-password-long', invitation_code: 'BETA' };
		expect((await foreign.request.post(`${ORIGIN}/api/auth/register`, { headers, data: credentials })).status()).toBe(201);
		expect((await foreign.request.post(`${ORIGIN}/api/auth/login`, { headers, data: credentials })).status()).toBe(200);
		expect((await foreign.request.get(`${ORIGIN}/api/projects/${project.id}`)).status()).toBe(404);
		expect((await foreign.request.patch(`${ORIGIN}/api/projects/${project.id}`, { headers, data: { name: 'Denied' } })).status()).toBe(404);
		const tab = await foreign.newPage();
		await tab.goto(`${ORIGIN}/projects/${project.id}`);
		await expect(tab.getByRole('heading', { name: 'Page not found' })).toBeVisible();
	} finally { await foreign.close(); }
	for (const origin of ['https://foreign.example', 'null']) {
		expect((await context.request.patch(`/api/projects/${project.id}`, { headers: { Origin: origin }, data: { name: 'Denied' } })).status()).toBe(403);
	}
});

test('projects beyond the first page remain accessible', async ({ page, context }) => {
	const oldest = await createProject(context.request, 'Project 0');
	for (let index = 1; index < 51; index++) await createProject(context.request, `Project ${index}`);
	await page.goto('/projects');
	await expect(page.locator('.project-list > a')).toHaveCount(50);
	await page.getByRole('button', { name: 'Load more projects' }).click();
	await expect(page.locator('.project-list > a')).toHaveCount(51);
	await expect(page.getByRole('button', { name: 'Load more projects' })).toHaveCount(0);
	await page.goto(`/projects/${oldest.id}/settings`);
	await expect(page.getByLabel('Switch project')).toHaveValue(oldest.id);
	await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Project 0');
});
