import { test as base } from '@playwright/test';
import { randomUUID } from 'node:crypto';
export const ORIGIN = 'http://127.0.0.1:3101';
export const PASSWORD = 'browser-test-password-only';
export const test = base.extend<{ account: { email: string } }>({
	account: [
		async ({ context }, use) => {
			const request = context.request;
			const email = `browser-${randomUUID()}@example.com`;
			const headers = {
				Origin: ORIGIN,
				'X-Test-Client-IP': `2001:db8:${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}::1`,
			};
			await context.setExtraHTTPHeaders(headers);
			const registration = await request.post(
				'/api/auth/register',
				{
					headers,
					data: {
						email,
						password: PASSWORD,
						display_name: 'Browser Test',
						invitation_code: 'BETA',
					},
				},
			);
			if (registration.status() !== 201)
				throw new Error(
					`Registration failed: ${registration.status()}`,
				);
			const login = await request.post('/api/auth/login', {
				headers,
				data: { email, password: PASSWORD },
			});
			if (!login.ok())
				throw new Error(
					`Login failed: ${login.status()}`,
				);
			await use({ email });
		},
		{ auto: true },
	],
});
