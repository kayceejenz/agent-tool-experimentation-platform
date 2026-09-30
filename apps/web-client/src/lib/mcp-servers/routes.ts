import 'server-only';
import { AuthError, checkOrigin, json } from '@/lib/auth/server';
import { ProjectApiError, projectApi } from '@/lib/projects/server';

const messages = {
	403: 'You no longer have permission to manage MCP connections.',
	404: 'Connection not found or you no longer have access.',
	409: 'This connection changed. Close the form, reload the connections, and try again.',
	422: 'Check the name, endpoint, and authentication. Changing a bearer-authenticated endpoint requires a new token.',
	503: 'Unable to save or load connections. The server or credential storage is unavailable. Please try again.',
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function mcpRoute(
	request: Request,
	projectId: string,
	serverId?: string,
) {
	try {
		if (
			!uuid.test(projectId) ||
			(serverId && !uuid.test(serverId))
		) {
			return json({ error: 'Connection not found.' }, 404);
		}
		let path = `/${projectId}/mcp-servers${serverId ? `/${serverId}` : ''}`;
		const init: RequestInit = { method: request.method };
		if (request.method === 'GET' && !serverId) {
			const params = new URLSearchParams({ limit: '20' });
			const cursor = new URL(request.url).searchParams.get(
				'cursor',
			);
			if (cursor) params.set('cursor', cursor);
			path += `?${params}`;
		} else if (request.method !== 'GET') {
			checkOrigin(request);
			if (
				!request.headers
					.get('content-type')
					?.startsWith('application/json')
			) {
				return json(
					{ error: 'Send JSON form data.' },
					415,
				);
			}
			try {
				init.body = JSON.stringify(
					await request.json(),
				);
			} catch {
				return json(
					{ error: 'Invalid connection data.' },
					400,
				);
			}
		}
		return json(
			await projectApi(path, init, messages),
			request.method === 'POST' ? 201 : 200,
		);
	} catch (error) {
		if (
			error instanceof ProjectApiError ||
			error instanceof AuthError
		) {
			return json({ error: error.message }, error.status);
		}
		return json(
			{ error: 'Connections are temporarily unavailable.' },
			503,
		);
	}
}
