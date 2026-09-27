import { defineConfig } from '@playwright/test';
export default defineConfig({
	testDir: './tests',
	fullyParallel: true,
	workers: 2,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	use: { extraHTTPHeaders: { 'X-Test-Client-IP': '192.0.2.1' }, baseURL: 'http://127.0.0.1:3101', trace: 'retain-on-failure' },
	webServer: {
		command: '../server/.venv/bin/python tests/run-auth-stack.py',
		url: 'http://127.0.0.1:3101/auth/signin',
		reuseExistingServer: false,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
		timeout: 60_000,
	},
});
