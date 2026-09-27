import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ORIGIN, PASSWORD } from './fixtures';

test.beforeEach(async ({ context }) => {
	await context.setExtraHTTPHeaders({
		'X-Test-Client-IP': `2001:db8:${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}::1`,
	});
});

async function registerAndLogin(page: import('@playwright/test').Page) {
	const email = `auth-${randomUUID()}@example.com`;
	await page.goto('/projects');
	await expect(page).toHaveURL(/\/auth\/signin/);
	await page.getByRole('tab', { name: 'Create account' }).click();
	await page.getByLabel('Display name').fill('Auth Test');
	await page.getByLabel('Email', { exact: true }).fill(email);
	await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
	await page.getByLabel('Invitation code').fill('BETA');
	await page
		.getByRole('button', { name: 'Create account', exact: true })
		.click();
	await expect(page).toHaveURL(/\/projects$/);
	return email;
}

test('registration, protected routes, private cookies, and logout', async ({
	page,
	context,
}) => {
	const email = await registerAndLogin(page);
	await expect(page.locator('.rail-user-name')).toHaveText('Auth Test');
	const cookies = await context.cookies();
	for (const name of ['agent_access_token', 'agent_refresh_token']) {
		const cookie = cookies.find(item => item.name === name);
		expect(cookie?.httpOnly).toBe(true);
		expect(cookie?.sameSite).toBe('Strict');
	}
	expect(await page.evaluate(() => document.cookie)).not.toContain(
		'agent_',
	);
	expect(
		await page.evaluate(() => Object.keys(localStorage)),
	).not.toContain('access_token');
	const me = await page.request.get('/api/auth/me');
	expect(await me.json()).toEqual({
		user: expect.objectContaining({ email }),
	});
	const other = await context.newPage();
	await other.goto('/');
	await expect(
		other.getByRole('heading', { name: 'Workspace overview' }),
	).toBeVisible();
	await page
		.getByRole('button', { name: 'Sign out', exact: true })
		.click();
	await expect(other).toHaveURL(/\/auth\/signin$/);
	await other.close();
	await expect(page).toHaveURL(/\/auth\/signin$/);
	expect(
		(await context.cookies()).filter(cookie =>
			cookie.name.startsWith('agent_'),
		),
	).toHaveLength(0);
	await page.goto('/projects');
	await expect(
		page.getByRole('heading', { name: 'Welcome back' }),
	).toBeVisible();
});

test('invalid invitations and passwords show actionable errors', async ({
	page,
}) => {
	await page.goto('/auth/signin');
	await page.getByRole('tab', { name: 'Create account' }).click();
	await page
		.getByLabel('Email', { exact: true })
		.fill(`invalid-${randomUUID()}@example.com`);
	await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
	await page.getByLabel('Invitation code').fill('NO');
	await page
		.getByRole('button', { name: 'Create account', exact: true })
		.click();
	await expect(page.getByRole('region').getByRole('alert')).toContainText(
		'invitation code is incorrect',
	);
	await expect(page.getByLabel('Invitation code')).not.toHaveAttribute(
		'minlength',
	);
	await expect(page.getByLabel('Invitation code')).not.toHaveAttribute(
		'maxlength',
	);
	await page.getByRole('tab', { name: 'Sign in', exact: true }).click();
	await page
		.getByRole('button', { name: 'Sign in', exact: true })
		.click();
	await expect(page.getByRole('region').getByRole('alert')).toContainText(
		'email or password is incorrect',
	);
});

test('expired access refreshes across tabs and invalid refresh returns to sign in', async ({
	page,
	context,
}) => {
	await registerAndLogin(page);
	const refresh = (await context.cookies()).find(
		cookie => cookie.name === 'agent_refresh_token',
	)!;
	await context.clearCookies({ name: 'agent_access_token' });
	const other = await context.newPage();
	await Promise.all([page.goto('/projects'), other.goto('/')]);
	await expect(page).toHaveURL(/\/projects$/);
	await expect(
		other.getByRole('heading', { name: 'Workspace overview' }),
	).toBeVisible();
	const renewed = (await context.cookies()).find(
		cookie => cookie.name === 'agent_refresh_token',
	)!;
	expect(renewed.value).not.toBe(refresh.value);
	await other.close();
	await context.clearCookies({ name: 'agent_access_token' });
	await context.addCookies([{ ...renewed, value: 'invalid-refresh' }]);
	await page.goto('/projects');
	await expect(page).toHaveURL(/\/auth\/signin.*SessionExpired/);
	await expect(page.getByRole('region').getByRole('alert')).toContainText(
		'session expired',
	);
});

test('mutations reject missing or foreign origins and callbacks stay local', async ({
	page,
	request,
}) => {
	for (const action of ['login', 'register', 'refresh', 'logout']) {
		expect(
			(
				await request.post(`/api/auth/${action}`, {
					data: {},
				})
			).status(),
		).toBe(403);
		expect(
			(
				await request.post(`/api/auth/${action}`, {
					headers: {
						Origin: 'https://foreign.example',
					},
					data: {},
				})
			).status(),
		).toBe(403);
	}
	const email = `callback-${randomUUID()}@example.com`;
	await request.post('/api/auth/register', {
		headers: { Origin: ORIGIN },
		data: { email, password: PASSWORD, invitation_code: 'BETA' },
	});
	await page.goto(
		'/auth/signin?callbackUrl=' +
			encodeURIComponent('/\\foreign.example'),
	);
	await page.getByLabel('Email', { exact: true }).fill(email);
	await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
	await page
		.getByRole('button', { name: 'Sign in', exact: true })
		.click();
	await expect(page).toHaveURL(ORIGIN + '/');
});

test('sign-in layout supports mobile, keyboard tabs, and both themes', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/auth/signin');
	await page.getByRole('tab', { name: 'Sign in', exact: true }).focus();
	await page.keyboard.press('ArrowRight');
	await expect(
		page.getByRole('tab', { name: 'Create account' }),
	).toBeFocused();
	await expect(
		page.getByRole('heading', { name: 'Create your account' }),
	).toBeVisible();
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				innerWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: 'test-results/auth-mobile-light.png',
		fullPage: true,
	});
	await page.getByRole('button', { name: 'Toggle color theme' }).click();
	await expect(page.locator('html')).toHaveAttribute(
		'data-theme',
		'dark',
	);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.screenshot({
		path: 'test-results/auth-desktop-dark.png',
		fullPage: true,
	});
});

test('temporary sign-in failures preserve form input and allow retry', async ({
	page,
}) => {
	await page.goto('/auth/signin');
	await page
		.getByLabel('Email', { exact: true })
		.fill('retry@example.com');
	await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
	await page.route('**/api/auth/login', route =>
		route.fulfill({
			status: 503,
			contentType: 'application/json',
			body: JSON.stringify({
				error: 'Authentication is temporarily unavailable. Please try again.',
			}),
		}),
	);
	await page
		.getByRole('button', { name: 'Sign in', exact: true })
		.click();
	await expect(page.getByRole('region').getByRole('alert')).toContainText(
		'temporarily unavailable',
	);
	await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
		'retry@example.com',
	);
	await expect(
		page.getByRole('button', { name: 'Sign in', exact: true }),
	).toBeEnabled();
});

test('rate limits isolate trusted client addresses and ignore browser forwarding headers', async ({
	request,
}) => {
	const headers = {
		Origin: ORIGIN,
		'X-Test-Client-IP': `2001:db8:${randomUUID().slice(0, 4)}::1`,
	};
	const data = {
		email: `missing-${randomUUID()}@example.com`,
		password: PASSWORD,
	};
	for (let attempt = 0; attempt < 10; attempt++) {
		expect(
			(
				await request.post('/api/auth/login', {
					headers,
					data,
				})
			).status(),
		).toBe(401);
	}
	expect(
		(
			await request.post('/api/auth/login', {
				headers: {
					...headers,
					'X-Forwarded-For': '203.0.113.99',
					'X-Agent-Client-IP': '203.0.113.99',
				},
				data,
			})
		).status(),
	).toBe(429);
	expect(
		(
			await request.post('/api/auth/login', {
				headers: {
					...headers,
					'X-Test-Client-IP': `2001:db8:${randomUUID().slice(0, 4)}::2`,
				},
				data,
			})
		).status(),
	).toBe(401);
});

test('an existing tab reconciles a changed account on focus', async ({
	page,
	context,
}) => {
	await registerAndLogin(page);
	const email = `changed-${randomUUID()}@example.com`;
	const headers = { Origin: ORIGIN };
	expect(
		(
			await context.request.post('/api/auth/register', {
				headers,
				data: {
					email,
					password: PASSWORD,
					invitation_code: 'BETA',
					display_name: 'Changed Account',
				},
			})
		).status(),
	).toBe(201);
	expect(
		(
			await context.request.post('/api/auth/login', {
				headers,
				data: { email, password: PASSWORD },
			})
		).ok(),
	).toBe(true);
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await expect(page.locator('.rail-user-name')).toHaveText(
		'Changed Account',
	);
});

test('a stalled login times out and releases the lock for retry', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const timeout = AbortSignal.timeout.bind(AbortSignal);
		AbortSignal.timeout = ms => timeout(ms === 15_000 ? 300 : ms);
	});
	await page.goto('/auth/signin');
	await page
		.getByLabel('Email', { exact: true })
		.fill('timeout@example.com');
	await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
	await page.route('**/api/auth/login', () => {});
	await page
		.getByRole('button', { name: 'Sign in', exact: true })
		.click();
	await expect(page.getByRole('region').getByRole('alert')).toContainText(
		'timed out',
	);
	await page.unroute('**/api/auth/login');
	await page
		.getByRole('button', { name: 'Sign in', exact: true })
		.click();
	await expect(page.getByRole('region').getByRole('alert')).toContainText(
		'email or password is incorrect',
	);
});

test('waiting for another tab has a bounded timeout', async ({
	page,
	context,
}) => {
	const other = await context.newPage();
	await other.goto('/auth/signin');
	await other.evaluate(() => {
		void navigator.locks.request(
			'agent-auth',
			() => new Promise<void>(() => {}),
		);
	});
	await expect
		.poll(() =>
			other.evaluate(async () =>
				(await navigator.locks.query()).held?.some(
					lock => lock.name === 'agent-auth',
				),
			),
		)
		.toBe(true);
	await page.addInitScript(() => {
		const timeout = AbortSignal.timeout.bind(AbortSignal);
		AbortSignal.timeout = ms => timeout(ms === 20_000 ? 300 : ms);
	});
	await page.goto('/auth/signin');
	await page
		.getByLabel('Email', { exact: true })
		.fill('lock@example.com');
	await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
	await page
		.getByRole('button', { name: 'Sign in', exact: true })
		.click();
	await expect(page.getByRole('region').getByRole('alert')).toContainText(
		'busy in another tab',
	);
	await other.close();
	await page
		.getByRole('button', { name: 'Sign in', exact: true })
		.click();
	await expect(page.getByRole('region').getByRole('alert')).toContainText(
		'email or password is incorrect',
	);
});
