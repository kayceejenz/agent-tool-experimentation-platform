import 'server-only';
import { BODY_LIMITS } from '@/lib/http/request-body';
import { json } from '@/lib/auth/server';
import { projectApi } from '@/lib/projects/server';
import {
	routeError,
	readRouteJson,
	uuidPattern as uuid,
} from '@/lib/http/project-route';

const messages = {
	403: 'You no longer have permission to manage MCP connections.',
	404: 'Connection not found or you no longer have access.',
	409: 'This connection changed. Close the form, reload the connections, and try again.',
	422: 'Check the name, endpoint, and authentication. Changing a bearer-authenticated endpoint requires a new token.',
	503: 'Unable to save or load connections. The server or credential storage is unavailable. Please try again.',
};

export async function mcpRoute(
	request: Request,
	projectId: string,
	serverId?: string,
	action?: 'check' | 'discover' | 'probe',
) {
	try {
		if (
			!uuid.test(projectId) ||
			(serverId && !uuid.test(serverId))
		) {
			return json({ error: 'Connection not found.' }, 404);
		}
		if (action === 'probe' && serverId) {
			return json({ error: 'Connection not found.' }, 404);
		}
		let path = `/${projectId}/mcp-servers${serverId ? `/${serverId}` : ''}${action ? `/${action}` : ''}`;
		const init: RequestInit = { method: request.method };
		if (request.method === 'GET' && !serverId) {
			const params = new URLSearchParams({ limit: '20' });
			const cursor = new URL(request.url).searchParams.get(
				'cursor',
			);
			if (cursor) params.set('cursor', cursor);
			path += `?${params}`;
		} else if (request.method !== 'GET') {
			init.body = await readRouteJson(
				request,
				BODY_LIMITS.mcp,
				'Send JSON form data.',
			);
		}
		return json(
			await projectApi(path, init, messages),
			request.method === 'POST' && !action ? 201 : 200,
		);
	} catch (error) {
		return routeError(
			error,
			'Connections are temporarily unavailable.',
		);
	}
}
