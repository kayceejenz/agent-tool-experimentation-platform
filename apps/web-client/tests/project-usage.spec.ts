import { expect } from '@playwright/test';
import { test, ORIGIN } from './fixtures';

test('project overview shows aggregated usage, accessible charts and mobile layout', async ({
	page,
	context,
}) => {
	const project = await (
		await context.request.post('/api/projects', {
			headers: { Origin: ORIGIN },
			data: { name: 'Usage workspace' },
		})
	).json();
	// Exercise the real authenticated read-only endpoint first.
	const empty = await context.request.get(
		`/api/projects/${project.id}/usage`,
	);
	expect(empty.ok()).toBeTruthy();
	expect((await empty.json()).totals.total_tokens).toBe(0);
	await page.goto(`/projects/${project.id}`);
	const panel = page.getByRole('region', { name: 'Token usage & costs' });
	await expect(panel.locator('dd').first()).toHaveText('0');
	await expect(
		page.getByRole('heading', { name: 'Your next step' }),
	).not.toBeVisible();
	const totals = {
		input_tokens: 12000,
		output_tokens: 3000,
		total_tokens: 15000,
		estimated_cost_usd: '0.0036',
		calls: 4,
		missing_usage_calls: 6,
		unpriced_calls: 5,
	};
	const days = Array.from({ length: 14 }, (_, i) => ({
		...totals,
		date: `2026-10-${String(i + 1).padStart(2, '0')}`,
		input_tokens: i === 13 ? 12000 : 0,
		output_tokens: i === 13 ? 3000 : 0,
		total_tokens: i === 13 ? 15000 : 0,
		estimated_cost_usd: i === 13 ? '0.0036' : '0',
	}));
	let fail = false;
	await page.route(`**/api/projects/${project.id}/usage`, route =>
		route.fulfill({
			status: fail ? 503 : 200,
			contentType: 'application/json',
			body: JSON.stringify(
				fail
					? {
							error: 'Usage could not be loaded.',
						}
					: {
							currency: 'USD',
							timezone: 'Europe/London',
							pricing_date:
								'2026-10-12',
							totals,
							sources: {
								agent: {
									...totals,
									input_tokens: 8000,
									output_tokens: 2000,
									total_tokens: 10000,
									estimated_cost_usd:
										'0.0024',
								},
								evaluation: {
									...totals,
									input_tokens: 4000,
									output_tokens: 1000,
									total_tokens: 5000,
									estimated_cost_usd:
										'0.0012',
								},
							},
							daily: days,
						},
			),
		}),
	);
	await panel.getByRole('button', { name: 'Refresh usage' }).click();
	await expect(panel.locator('dd').first()).toHaveText('15,000');
	await expect(panel.getByText(/Totals are incomplete/)).toHaveCount(0);
	await expect(panel.locator('dd').last()).toHaveText('$0.0036');
	await expect(
		panel.getByRole('img', { name: /Daily token usage/ }),
	).not.toBeVisible();
	await page.screenshot({
		path: 'test-results/project-usage-simple-desktop.png',
	});
	await panel.getByText('View usage trends', { exact: true }).click();
	await expect(
		panel.getByRole('img', { name: /Daily token usage/ }),
	).toBeVisible();
	const daysGroup = panel.getByRole('group', {
		name: 'Daily usage values',
	});
	await daysGroup.getByRole('button').last().hover();
	await expect(panel.getByRole('tooltip')).toContainText('15,000 tokens');
	await expect(panel.getByRole('tooltip')).toContainText(
		'$0.0036 estimated cost',
	);
	await daysGroup.getByRole('button').first().focus();
	await expect(panel.getByRole('tooltip')).toContainText('0 tokens');
	await page.keyboard.press('Escape');
	await expect(panel.getByRole('tooltip')).toHaveCount(0);

	await panel.getByRole('button', { name: 'Cost', exact: true }).click();
	await expect(
		panel.getByRole('button', { name: 'Cost', exact: true }),
	).toHaveAttribute('aria-pressed', 'true');
	await expect(
		panel.getByRole('img', { name: /Daily estimated cost/ }),
	).toBeVisible();
	await panel.getByText('Daily usage details', { exact: true }).click();
	await expect(panel.getByRole('table').last()).toContainText('15,000');
	await page.screenshot({
		path: 'test-results/project-usage-desktop.png',
		fullPage: true,
	});
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				window.innerWidth,
		),
	).toBeTruthy();
	await page.screenshot({
		path: 'test-results/project-usage-mobile.png',
		fullPage: true,
	});
	await panel.getByText('View usage trends', { exact: true }).click();
	await page.screenshot({
		path: 'test-results/project-usage-simple-mobile.png',
	});
	fail = true;
	await panel.getByRole('button', { name: 'Refresh usage' }).click();
	await expect(panel.getByRole('alert')).toHaveText(
		'Usage could not be loaded.',
	);
	fail = false;
	await panel.getByRole('button', { name: 'Refresh usage' }).click();
	await expect(panel.locator('dd').first()).toHaveText('15,000');
});
