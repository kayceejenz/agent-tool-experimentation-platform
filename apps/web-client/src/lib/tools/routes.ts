import 'server-only';
import { BODY_LIMITS } from '@/lib/http/request-body';
import { json } from '@/lib/auth/server';
import { projectApi } from '@/lib/projects/server';
import {
	routeError,
	readRouteJson,
	uuidPattern as uuid,
} from '@/lib/http/project-route';

export async function toolRoute(
	request: Request,
	projectId: string,
	toolId?: string,
	executions = false,
) {
	try {
		if (!uuid.test(projectId) || (toolId && !uuid.test(toolId)))
			return json({ error: 'Tool not found.' }, 404);
		let path = `/${projectId}/tools${toolId ? `/${toolId}` : ''}${executions ? '/executions' : ''}`;
		const init: RequestInit = { method: request.method };
		if (request.method === 'GET' && !toolId) {
			const incoming = new URL(request.url).searchParams;
			const params = new URLSearchParams();
			for (const key of [
				'server_id',
				'offset',
				'q',
				'summary',
			])
				if (incoming.has(key))
					params.set(key, incoming.get(key)!);
			path += `?${params}`;
		} else if (request.method !== 'GET') {
			init.body = await readRouteJson(
				request,
				BODY_LIMITS.tool,
				'Send JSON data.',
			);
		}
		return json(
			await projectApi(path, init, {
				403: 'Your role cannot manage or test tools.',
				404: 'Tool not found or access removed.',
				409: 'Tool changed or is disabled. Refresh and enable the server and tool before testing.',
				422: 'Inputs do not match the schema, or the schema is unsupported. Review the input schema.',
				503: 'Unable to complete the request. Check test history before running again.',
			}),
		);
	} catch (error) {
		return routeError(
			error,
			'Tools are temporarily unavailable. Check history before running again.',
		);
	}
}

export async function toolOperationRoute(
	projectId: string,
	toolId: string,
	requestId: string,
) {
	if (![projectId, toolId, requestId].every(id => uuid.test(id)))
		return json({ error: 'Operation not found.' }, 404);
	try {
		return json(
			await projectApi(
				`/${projectId}/tools/${toolId}/executions/requests/${requestId}`,
			),
		);
	} catch (error) {
		return routeError(
			error,
			'Unable to check this operation. Please try again.',
		);
	}
}
