import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test, ORIGIN } from './fixtures';

test('save a manual reference and compare an agent without advanced configuration', async ({
	page,
	context,
}) => {
	const headers = { Origin: ORIGIN };
	const project = await (
		await context.request.post('/api/projects', {
			headers,
			data: { name: 'Simple benchmarks' },
		})
	).json();
	const base = `/api/projects/${project.id}`;
	const server = await (
		await context.request.post(`${base}/mcp-servers`, {
			headers,
			data: {
				name: 'Demo store',
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
	const tools = (
		await (await context.request.get(`${base}/tools`)).json()
	).items;
	const tool = tools.find(
		(t: { name: string }) => t.name === 'describe_store',
	);
	await context.request.patch(`${base}/tools/${tool.id}`, {
		headers,
		data: { enabled: true, revision: tool.revision },
	});
	const response = await context.request.post(
		`${base}/tools/${tool.id}/executions`,
		{
			headers,
			data: {
				revision: tool.revision,
				arguments: {},
				request_id: randomUUID(),
			},
		},
	);
	expect(response.ok()).toBeTruthy();
	const capture = await response.json();
	expect(capture.status).toBe('success');
	await page.goto(
		`/projects/${project.id}/benchmarks?capture=${capture.id}`,
	);
	await page
		.getByLabel('Question for the agent')
		.fill('Describe this store.');
	await expect(
		page.getByRole('button', { name: 'Save example' }),
	).toBeDisabled();
	await page
		.getByLabel(
			'I checked that this call correctly answers the question.',
		)
		.check();
	await page.getByRole('button', { name: 'Save example' }).click();
	await expect(page.getByRole('status')).toContainText('Example saved');
	const refs: Record<string, { id: string; revision: number }> = {};
	for (const type of ['system', 'agent']) {
		const prompt = await (
			await context.request.post(`${base}/prompts`, {
				headers,
				data: {
					name: `${type} instructions`,
					type,
					content: 'Use available tools.',
				},
			})
		).json();
		refs[`${type}_prompt`] = { id: prompt.id, revision: 1 };
	}
	const agent = await (
		await context.request.post(`${base}/agents`, {
			headers,
			data: {
				name: 'Baseline',
				...refs,
				model_settings: {
					provider: 'openai',
					model: 'gpt-4o-mini',
				},
				tools: [
					{
						id: tool.id,
						revision: tool.revision,
					},
				],
			},
		})
	).json();
	await context.request.patch(`${base}/agents/${agent.id}`, {
		headers,
		data: { enabled: true, base_revision: 1 },
	});
	const second = await context.request.post(`${base}/benchmarks`, {
		headers,
		data: {
			request_id: randomUUID(),
			capture_id: capture.id,
			input: 'Tell me about this shop.',
		},
	});
	expect(second.status()).toBe(201);
	const runs = new Map<string, string>();
	// Only model responses are substituted; backend integration tests exercise the actual runtime.
	await page.route(
		`**${base}/agents/${agent.id}/executions`,
		async route => {
			const body = route.request().postDataJSON();
			expect(body.revision).toBe(1);
			expect(body.benchmark_id).toBeTruthy();
			const id = randomUUID();
			runs.set(body.benchmark_id, id);
			await route.fulfill({
				status: 202,
				json: { id, status: 'queued' },
			});
		},
	);
	await page.route(`**${base}/benchmarks`, async route => {
		const body = await (await route.fetch()).json();
		let scored = 0;
		for (const item of body.items) {
			if (!runs.has(item.id)) continue;
			scored++;
			item.execution_id = runs.get(item.id);
			item.status = 'completed';
			item.termination_reason = 'final_answer';
			item.agent_name = 'Baseline';
			item.agent_revision = 1;
			const correct = item.input === 'Describe this store.';
			item.calls = [
				{
					name: 'Demo store / describe_store',
					inputs: correct
						? {}
						: { unexpected: true },
					status: 'success',
				},
			];
			item.score = {
				actual_count: 1,
				matched_count: 1,
				arguments_correct: correct,
			};
		}
		body.metrics = {
			scored,
			precision: scored ? 100 : null,
			recall: scored ? 100 : null,
			arguments: scored ? 100 / scored : null,
		};
		await route.fulfill({ json: body });
	});
	const references = (
		await (await context.request.get(`${base}/benchmarks`)).json()
	).items;
	await page.route(`**${base}/benchmarks/runs/*`, async route => {
		const executionId = new URL(route.request().url()).pathname
			.split('/')
			.pop();
		const original = references.find(
			(item: { id: string }) =>
				runs.get(item.id) === executionId,
		);
		const correct = original.input === 'Describe this store.';
		await route.fulfill({
			json: {
				...original,
				execution_id: executionId,
				agent_name: 'Baseline',
				agent_revision: 1,
				status: 'completed',
				termination_reason: 'final_answer',
				final_answer: 'The store uses GBP.',
				calls: [
					{
						name: 'Demo store / describe_store',
						inputs: correct
							? {}
							: { unexpected: true },
						status: 'success',
					},
				],
				score: {
					actual_count: 1,
					matched_count: 1,
					arguments_correct: correct,
				},
			},
		});
	});
	const modelSpan = randomUUID(),
		toolSpan = randomUUID();
	const spans = [
		{
			id: modelSpan,
			sequence: 1,
			kind: 'model',
			parent_id: null,
			name: 'Model turn 1',
			status: 'success',
			context_span_ids: [],
			duration_ms: 120,
		},
		{
			id: toolSpan,
			sequence: 2,
			kind: 'tool',
			parent_id: modelSpan,
			name: 'Demo store / describe_store',
			status: 'success',
			context_span_ids: [],
			duration_ms: 40,
		},
	];
	await page.route(`**${base}/executions/*/spans**`, async route => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/spans'))
			await route.fulfill({
				json: { items: spans, next_offset: null },
			});
		else if (path.endsWith(modelSpan))
			await route.fulfill({
				json: {
					...spans[0],
					inputs: { message_count: 1 },
					outputs: [
						{
							text: '',
							usage: {
								input_count: 2807,
								output_count: 33,
							},
							tool_calls: [
								{
									id: 'call_example',
									args: {
										limit: 1,
									},
									name: 'tool_example',
									type: 'tool_call',
								},
							],
						},
					],
				},
			});
		else
			await route.fulfill({
				json: {
					...spans[1],
					inputs: { month: 9 },
					outputs: {
						result: {
							content: [
								{
									type: 'text',
									text: JSON.stringify(
										{
											sales: 42,
											currency: 'GBP',
											products: [
												{
													name: 'Cotton shirt with a longer product name',
													price: 29,
													units: 4,
												},
												{
													name: 'Wool scarf',
													price: 18,
													units: 2,
												},
											],
										},
									),
								},
							],
						},
					},
				},
			});
	});
	await page.goto(`/projects/${project.id}/benchmarks`);
	await expect(
		page.getByRole('list', { name: 'How to use benchmarks' }),
	).toHaveCount(0);
	await expect(
		page
			.locator('.workspace-header')
			.getByRole('link', { name: 'Add new example' }),
	).toBeVisible();
	await expect(
		page
			.getByRole('region', {
				name: 'Saved questions',
				exact: true,
			})
			.getByRole('button', { name: 'Refresh', exact: true }),
	).toBeVisible();
	await expect(page.getByLabel('Agent to test')).toHaveCount(0);
	await expect(
		page.getByRole('button', { name: 'Run: Describe this store.' }),
	).toBeEnabled();
	const first = page
		.getByRole('row')
		.filter({ hasText: 'Describe this store.' });
	await first.getByRole('button', { name: /^Run: / }).click();
	const popup = page.getByRole('dialog', { name: 'Run benchmark' });
	await expect(popup).toBeVisible();
	await expect(popup.getByLabel('Agent to test')).toBeEnabled();
	await page.screenshot({ path: 'test-results/benchmark-run-popup.png' });
	await popup.press('Escape');
	await expect(popup).toHaveCount(0);
	await expect(
		first.getByRole('button', { name: /^Run: / }),
	).toBeFocused();
	await first.getByRole('button', { name: /^Run: / }).click();
	await popup.getByLabel('Agent to test').selectOption(agent.id);
	await popup
		.getByRole('button', { name: 'Start run', exact: true })
		.click();
	await expect(popup).toHaveCount(0);
	await expect(
		first.getByRole('cell', { name: /Tool and inputs match/ }),
	).toBeVisible();
	await expect(
		page.getByRole('region', { name: 'Selected run' }),
	).toHaveCount(0);
	await expect(
		page.getByRole('link', { name: 'View trace' }),
	).toHaveCount(0);
	const other = page
		.getByRole('row')
		.filter({ hasText: 'Tell me about this shop.' });
	await other.getByRole('button', { name: /^Run: / }).click();
	await popup.getByLabel('Agent to test').selectOption(agent.id);
	await popup
		.getByRole('button', { name: 'Start run', exact: true })
		.click();
	await expect(popup).toHaveCount(0);
	await expect(
		other.getByRole('cell', {
			name: /Right tool, different inputs/,
		}),
	).toBeVisible();
	await expect(page.getByRole('row').nth(1)).toContainText(
		'Tell me about this shop.',
	);
	await other
		.getByRole('link', {
			name: 'View result: Tell me about this shop.',
		})
		.click();
	await expect(page).toHaveURL(/benchmarks\/runs\//);
	await page.reload();
	await expect(page.getByLabel('Agent to test')).toHaveCount(0);
	const details = page.getByRole('region', { name: 'Run result' });
	await expect(details).toBeVisible();
	await expect(
		details
			.locator('dl[aria-label="Selected run metrics"]')
			.getByRole('definition'),
	).toHaveText(['100.0%', '100.0%', '0.0%']);
    const precisionInfo = details.getByRole('button', { name: 'About tool precision' });
    await precisionInfo.hover();
    await expect(details.getByRole('tooltip')).toContainText('extra or repeated calls');
    await page.mouse.move(0, 0);
    await expect(details.getByRole('tooltip')).toHaveCount(0);
    const argumentInfo = details.getByRole('button', { name: 'About argument accuracy' });
    await argumentInfo.focus();
    await expect(details.getByRole('tooltip')).toContainText('JSON key order does not matter');
    await argumentInfo.press('Escape');
    await expect(details.getByRole('tooltip')).toHaveCount(0);
    await details.getByRole('button', { name: 'About tool recall' }).click();
    await expect(details.getByRole('tooltip')).toContainText('Each question expects one call');
    await details.getByRole('button', { name: 'About tool recall' }).press('Escape');

	await expect(
		details.getByText('unexpected', { exact: false }),
	).toBeVisible();
	await expect(
		details.getByRole('button', { name: /evaluat/i }),
	).toHaveCount(0);
	await expect(
		details.getByRole('button', { name: 'Hide execution steps' }),
	).toHaveAttribute('aria-expanded', 'true');
	await expect(details.locator('.execution-span')).toHaveCount(2);
	await details.locator(`#span-${modelSpan} > summary`).click();
	const modelResponse = details
		.locator(`#span-${modelSpan}`)
		.getByRole('region', { name: 'Step response', exact: true });
	await expect(modelResponse).toContainText('2807');
	await expect(modelResponse).toContainText('33');
	await expect(modelResponse).toContainText('call_example');
	await expect(modelResponse).toContainText('tool_example');
	await expect(modelResponse.locator('pre')).toContainText(
		'\"limit\": 1',
	);
	const modelJson = JSON.parse(
		(await modelResponse.locator('pre').textContent())!,
	);
	expect(modelJson[0].usage).toEqual({
		input_count: 2807,
		output_count: 33,
	});
	await expect(modelResponse.getByRole('table')).toHaveCount(0);
	await page.screenshot({
		path: 'test-results/benchmark-model-response.png',
		fullPage: true,
	});
	await details.locator(`#span-${modelSpan} > summary`).click();
	await details.locator(`#span-${toolSpan} > summary`).click();
	const responseView = details.getByRole('region', {
		name: 'Step response',
		exact: true,
	});
	await expect(responseView.getByRole('table')).toHaveCount(0);
	const responseJson = JSON.parse(
		(await responseView.locator('pre').textContent())!,
	);
	expect(responseJson.sales).toBe(42);
	expect(responseJson.currency).toBe('GBP');
	expect(responseJson.products[1].name).toBe('Wool scarf');
	await expect(responseView.getByRole('button')).toHaveCount(0);
	const inputView = details.getByRole('region', {
		name: 'Step inputs',
		exact: true,
	});
	expect(
		await responseView.evaluate(element => element.clientWidth),
	).toBeGreaterThan(500);
	expect(
		await responseView.evaluate(
			element => element.getBoundingClientRect().top,
		),
	).toBeGreaterThan(
		await inputView.evaluate(
			element => element.getBoundingClientRect().bottom,
		),
	);
	await page.screenshot({
		path: 'test-results/benchmark-formatted-trace.png',
		fullPage: true,
	});
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				innerWidth,
		),
	).toBeTruthy();
	await page.screenshot({
		path: 'test-results/benchmark-formatted-trace-mobile.png',
		fullPage: true,
	});
	await page.setViewportSize({ width: 1280, height: 720 });
	await page
		.getByRole('link', { name: 'Back to benchmarks', exact: false })
		.click();
	await expect(details).toHaveCount(0);
	await expect(page.getByLabel('Agent to test')).toHaveCount(0);
	await expect(
		other.getByRole('link', {
			name: 'View result: Tell me about this shop.',
		}),
	).toBeVisible();
	await expect(page.getByRole('definition')).toHaveCount(0);
	await expect(
		page.getByText('2 of 2 questions scored.', { exact: false }),
	).toHaveCount(0);
	await first
		.getByRole('link', {
			name: 'View result: Describe this store.',
		})
		.click();
	await expect(
		details
			.locator('dl[aria-label="Selected run metrics"]')
			.getByRole('definition'),
	).toHaveText(['100.0%', '100.0%', '100.0%']);
	await page
		.getByRole('link', { name: 'Back to benchmarks', exact: false })
		.click();
	await expect(
		first.getByRole('link', {
			name: 'View result: Describe this store.',
		}),
	).toBeVisible();
	await page.screenshot({
		path: 'test-results/simple-benchmarks.png',
		fullPage: true,
	});
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <=
				innerWidth,
		),
	).toBeTruthy();
	await page.screenshot({
		path: 'test-results/simple-benchmarks-mobile.png',
		fullPage: true,
	});
});
