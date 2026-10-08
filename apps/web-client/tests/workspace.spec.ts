import { expect } from '@playwright/test';
import { test } from './fixtures';

test('empty workspace has no sample data or project-scoped links', async ({
	page,
}) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/projects$/);
	await expect(
		page.getByRole('heading', { name: 'Workspace overview' }),
	).toHaveCount(0);
	await expect(
		page.getByRole('heading', { name: 'Projects', exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'No projects yet' }),
	).toBeVisible();
	await page.screenshot({
		path: 'test-results/workspace-desktop.png',
		fullPage: true,
	});
	await expect(page.getByLabel('Switch project')).toHaveCount(0);
	await expect(
		page.locator(
			'a[href^="/projects/"]:not([href="/projects/new"])',
		),
	).toHaveCount(0);
	await expect(
		page.getByText(
			/Sales research|Support assistant|Sample project|Preview data/,
		),
	).toHaveCount(0);
	await expect(
		page
			.getByRole('navigation', {
				name: 'Workspace navigation',
			})
			.getByText('MCP Servers'),
	).toBeVisible();
	await page
		.getByRole('navigation', { name: 'Workspace navigation' })
		.getByRole('link', { name: 'Projects', exact: true })
		.click();
	await expect(
		page.getByRole('heading', { name: 'No projects yet' }),
	).toBeVisible();
	for (const path of [
		'/projects/sales-research',
		'/projects/support-assistant/tools',
	]) {
		await page.goto(path);
		await expect(
			page.getByRole('heading', { name: 'Page not found' }),
		).toBeVisible();
	}
});

test('every sidebar destination renders a real page', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/projects$/);
	await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
	const hrefs = await page
		.getByRole('navigation', { name: 'Workspace navigation' })
		.getByRole('link')
		.evaluateAll(links =>
			links.map(link => link.getAttribute('href')!),
		);
	expect(hrefs.length).toBeGreaterThan(0);
	for (const href of hrefs) {
		const response = await page.goto(href);
		expect(response?.status()).toBe(200);
		await expect(page.locator('main h1')).toBeVisible();
	}
});

test('theme preference follows the system initially and persists after toggling', async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute(
		'data-theme',
		'dark',
	);
	await expect(page.locator('body')).toHaveCSS(
		'background-color',
		'rgb(23, 23, 23)',
	);
	await page.getByRole('button', { name: 'Toggle color theme' }).click();
	await expect(page.locator('html')).toHaveAttribute(
		'data-theme',
		'light',
	);
	await expect(page.locator('body')).toHaveCSS(
		'background-color',
		'rgb(251, 250, 248)',
	);
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute(
		'data-theme',
		'light',
	);
	await page.getByRole('button', { name: 'Toggle color theme' }).focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('html')).toHaveAttribute(
		'data-theme',
		'dark',
	);
	await expect(page.locator('body')).toHaveCSS(
		'background-color',
		'rgb(23, 23, 23)',
	);
});

test('mobile menu supports keyboard dismissal and closes after navigation without overflow', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await expect(
		page.getByRole('button', { name: 'Toggle color theme' }),
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Sign out', exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: 'test-results/workspace-mobile.png',
		fullPage: true,
	});
	const menu = page.getByRole('button', {
		name: 'Open workspace navigation',
	});
	await expect(
		page.getByRole('navigation', { name: 'Workspace navigation' }),
	).not.toBeVisible();
	await menu.click();
	await expect(
		page.getByRole('navigation', { name: 'Workspace navigation' }),
	).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menu).toBeFocused();
	await expect(menu).toHaveAttribute('aria-expanded', 'false');
	await menu.click();
	await page
		.getByRole('navigation', { name: 'Workspace navigation' })
		.getByRole('link', { name: 'Projects', exact: true })
		.click();
	await expect(page).toHaveURL(/\/projects$/);
	await expect(menu).toHaveAttribute('aria-expanded', 'false');
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				window.innerWidth,
		),
	).toBe(true);
});
