import 'server-only';
import {
	BODY_LIMITS,
	readBoundedJson,
	readBoundedBody,
} from '@/lib/http/request-body';
import { checkOrigin, json } from '@/lib/auth/server';
import { projectApi } from '@/lib/projects/server';
import { routeError, uuidPattern as uuid } from '@/lib/http/project-route';

export async function executionRoute(
	request: Request,
	projectId: string,
	id: string,
	mode: 'agent' | 'detail' | 'cancel',
) {
	if (!uuid.test(projectId) || !uuid.test(id))
		return json({ error: 'Execution not found.' }, 404);
	try {
		let path = `/${projectId}/${mode === 'agent' ? `agents/${id}/executions` : `executions/${id}${mode === 'cancel' ? '/cancel' : ''}`}`;
		if (mode === 'cancel') path += '?view=summary';
		const init: RequestInit = { method: request.method };
		if (request.method === 'GET') {
			const input = new URL(request.url).searchParams,
				query = new URLSearchParams();
			for (const key of ['offset', 'view'])
				if (input.has(key))
					query.set(key, input.get(key)!);
			path += `?${query}`;
		} else {
			checkOrigin(request);
			if (mode === 'agent') {
				if (
					!request.headers
						.get('content-type')
						?.startsWith('application/json')
				)
					return json(
						{ error: 'Send JSON data.' },
						415,
					);
				init.body = JSON.stringify(
					await readBoundedJson(
						request,
						BODY_LIMITS.execution,
					),
				);
			} else {
				await readBoundedBody(
					request,
					BODY_LIMITS.control,
				);
			}
		}
		return json(
			await projectApi(path, init, {
				403: 'Your role cannot run or cancel agents.',
				404: 'Execution not found or access removed.',
				409: 'Enable the current agent revision and its tools, or wait for pending runs to finish.',
				422: 'Check the task and select an OpenAI agent configuration.',
				503: 'Executions are temporarily unavailable. Please try again.',
			}),
			request.method === 'POST' && mode === 'agent'
				? 202
				: 200,
		);
	} catch (error) {
		return routeError(
			error,
			'Executions are temporarily unavailable.',
		);
	}
}

export async function traceRoute(
	request: Request,
	projectId: string,
	executionId: string,
	mode: 'spans' | 'snapshot',
	spanId?: string,
) {
	if (
		![projectId, executionId, ...(spanId ? [spanId] : [])].every(
			id => uuid.test(id),
		)
	)
		return json({ error: 'Execution not found.' }, 404);
	try {
		const query = new URLSearchParams();
		const offset = new URL(request.url).searchParams.get('offset');
		if (offset !== null && mode === 'spans' && !spanId)
			query.set('offset', offset);
		return json(
			await projectApi(
				`/${projectId}/executions/${executionId}/${mode}${spanId ? `/${spanId}` : ''}?${query}`,
			),
		);
	} catch (error) {
		return routeError(
			error,
			'Execution details are temporarily unavailable.',
		);
	}
}
