import { expect } from '@playwright/test';
import { test, ORIGIN } from './fixtures';

test('upload, inspect, recover preview and browse datasets on mobile', async ({
	page,
	context,
}) => {
	const project = await (
		await context.request.post('/api/projects', {
			headers: { Origin: ORIGIN },
			data: { name: 'Dataset workspace' },
		})
	).json();
	await page.goto(`/projects/${project.id}/datasets`);
	await expect(
		page.getByRole('heading', { name: 'Add your first dataset' }),
	).toBeVisible();
	await page.screenshot({
		path: 'test-results/datasets-empty.png',
		fullPage: true,
	});
	await page
		.getByRole('button', { name: 'Upload dataset', exact: true })
		.click();
	await page.getByLabel('Dataset name').fill('Behaviour trial');
	await page.screenshot({
		path: 'test-results/datasets-upload.png',
		fullPage: true,
	});
	await page.getByLabel('Choose CSV files').setInputFiles([
		{
			name: 'events.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from('Animal_ID,Duration_s\n001,24\n002,36\n'),
		},
		{
			name: 'animals.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from('Animal_ID,Pen_ID\n001,P1\n'),
		},
	]);
	await expect(page.getByText('2 selected', { exact: false })).toBeVisible();
	await page.getByRole('button', { name: 'Save dataset', exact: true }).click();
	await expect(
		page.getByRole('status').filter({ hasText: 'uploaded' }),
	).toContainText('uploaded');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page
		.getByRole('button', {
			name: 'Collapse Behaviour trial',
			exact: true,
		})
		.click();
	await expect(page.getByRole('button', { name: /events.csv/ })).toHaveCount(0);
	await page
		.getByRole('button', {
			name: 'Expand Behaviour trial',
			exact: true,
		})
		.click();
	await page.getByRole('button', { name: /events.csv/ }).click();
	await expect(
		page.getByRole('heading', { name: 'Preview: events.csv' }),
	).toBeVisible();
	await expect(page.getByRole('dialog').locator('tbody tr')).toHaveCount(2);
	await expect(page.getByRole('dialog').locator('tbody')).toContainText('001');
	await page.screenshot({
		path: 'test-results/datasets-desktop.png',
		fullPage: true,
	});
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Close', exact: true })
		.click();
	await expect(page.getByRole('button', { name: /events.csv/ })).toBeFocused();
	await page.route('**/datasets/*/files/*/preview', route =>
		route.fulfill({
			status: 503,
			json: { error: 'Preview temporarily unavailable.' },
		}),
	);
	await page.getByRole('button', { name: /animals.csv/ }).click();
	await expect(page.locator('main').getByRole('alert')).toContainText(
		'Preview temporarily unavailable',
	);
	await page.unroute('**/datasets/*/files/*/preview');
	await page.getByRole('button', { name: 'Retry preview' }).click();
	await expect(page.getByRole('dialog').locator('tbody tr')).toHaveCount(1);
	await page.reload();
	await expect(
		page.getByRole('dialog', { name: 'File preview' }),
	).toBeVisible();
	await expect(page.getByRole('dialog').locator('tbody tr')).toHaveCount(1);
	await page.keyboard.press('Escape');
	await page.reload();
	await expect(page.getByRole('button', { name: /animals.csv/ })).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page.getByRole('button', { name: /events.csv/ }).click();
	await expect(
		page.getByRole('dialog', { name: 'File preview' }),
	).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.screenshot({
		path: 'test-results/datasets-mobile.png',
		fullPage: true,
	});
});

test('upload validation preserves files and shows removable selections', async ({
	page,
	context,
}) => {
	const project = await (
		await context.request.post('/api/projects', {
			headers: { Origin: ORIGIN },
			data: { name: 'Dataset validation' },
		})
	).json();
	await page.goto(`/projects/${project.id}/datasets`);
	await page
		.getByRole('button', { name: 'Upload dataset', exact: true })
		.click();
	await page.getByLabel('Dataset name').fill('Keep my input');
	await page.getByLabel('Choose CSV files').setInputFiles({
		name: 'empty.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(''),
	});
	await page.getByRole('button', { name: 'Save dataset', exact: true }).click();
	await expect(page.locator('main').getByRole('alert')).toContainText(
		'nonempty CSV',
	);
	await expect(page.getByLabel('Dataset name')).toHaveValue('Keep my input');
	await page.getByRole('button', { name: 'Remove empty.csv' }).click();
	await expect(
		page.getByRole('button', { name: 'Save dataset', exact: true }),
	).toBeDisabled();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(
		page.getByRole('button', {
			name: 'Upload dataset',
			exact: true,
		}),
	).toBeFocused();
});
