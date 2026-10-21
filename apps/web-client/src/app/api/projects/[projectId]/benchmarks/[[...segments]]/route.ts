import { checkOrigin, json } from '@/lib/auth/server';
import { projectApi } from '@/lib/projects/server';
import { routeError, uuidPattern } from '@/lib/http/project-route';
import { BODY_LIMITS, readBoundedJson } from '@/lib/http/request-body';

type Context = { params: Promise<{ projectId: string; segments?: string[] }> };
async function route(request: Request, context: Context) {
	const { projectId, segments = [] } = await context.params;

	const capture =
		segments.length === 2 &&
		segments[0] === 'captures' &&
		uuidPattern.test(segments[1]);

	const run =
		segments.length === 2 &&
		segments[0] === 'runs' &&
		uuidPattern.test(segments[1]);

	const history =
		segments.length === 2 &&
		uuidPattern.test(segments[0]) &&
		segments[1] === 'runs';

	const performance =
		request.method === 'GET' &&
		segments.length === 1 &&
		segments[0] === 'performance';

	const deletion =
		request.method === 'DELETE' &&
		segments.length === 1 &&
		uuidPattern.test(segments[0]);

	if (
		!uuidPattern.test(projectId) ||
		(segments.length &&
			!capture &&
			!run &&
			!history &&
			!deletion &&
			!performance) ||
		(request.method === 'POST' && (capture || run || history)) ||
		(request.method === 'DELETE' && !deletion)
	)
		return json({ error: 'Benchmark not found.' }, 404);
	try {
		const init: RequestInit = { method: request.method };
		const query = new URLSearchParams();
		if (request.method === 'DELETE') checkOrigin(request);
		if (request.method === 'POST') {
			checkOrigin(request);
			if (
				!request.headers
					.get('content-type')
					?.startsWith('application/json')
			)
				return json({ error: 'Send JSON data.' }, 415);
			init.body = JSON.stringify(
				await readBoundedJson(
					request,
					BODY_LIMITS.execution,
				),
			);
		} else {
			const agent = new URL(request.url).searchParams.get(
				'agent_id',
			);
			if (agent) query.set('agent_id', agent);
		}
		return json(
			await projectApi(
				`/${projectId}/benchmarks${capture ? `/captures/${segments[1]}` : run ? `/runs/${segments[1]}` : history ? `/${segments[0]}/runs` : deletion ? `/${segments[0]}` : performance ? '/performance' : ''}?${query}`,
				init,
				{
					404: 'Benchmark or successful manual test not found in this project.',
					409: 'This request was already used. Refresh before saving again.',
					422: 'Enter a question and select a successful manual tool test.',
				},
			),
			request.method === 'POST' ? 201 : 200,
		);
	} catch (error) {
		return routeError(
			error,
			'Benchmarks could not be loaded. Please try again.',
		);
	}
}

export const GET = route;
export const POST = route;
export const DELETE = route;
