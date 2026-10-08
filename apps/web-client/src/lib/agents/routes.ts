import 'server-only';
import { BODY_LIMITS } from '@/lib/http/request-body';
import { json } from '@/lib/auth/server';
import { projectApi } from '@/lib/projects/server';
import {
	routeError,
	readRouteJson,
	uuidPattern as uuid,
} from '@/lib/http/project-route';

export async function agentRoute(
	request: Request,
	projectId: string,
	agentId?: string,
	revisions = false,
	revision?: string,
) {
	try {
		if (
			!uuid.test(projectId) ||
			(agentId && !uuid.test(agentId)) ||
			(revision && !/^[1-9]\d{0,8}$/.test(revision))
		)
			return json({ error: 'Agent not found.' }, 404);
		let path = `/${projectId}/agents${agentId ? `/${agentId}` : ''}${revisions ? '/revisions' : ''}${revision ? `/${revision}` : ''}`;
		const init: RequestInit = { method: request.method };
		if (request.method === 'GET') {
			const incoming = new URL(request.url).searchParams,
				params = new URLSearchParams();
			for (const key of ['offset'])
				if (incoming.has(key))
					params.set(key, incoming.get(key)!);
			path += `?${params}`;
		} else {
			init.body = await readRouteJson(
				request,
				BODY_LIMITS.configuration,
				'Send JSON data.',
			);
		}
		return json(
			await projectApi(path, init, {
				403: 'Your project role cannot edit agents.',
				404: 'Agent not found or access removed.',
				409: 'The agent changed or is not ready to enable. Resolve configuration issues or reload; your unsaved edits are retained.',
				422: 'Check field limits and select matching prompt and tool revisions from this project.',
				503: 'Agents are temporarily unavailable. Your edits have been retained.',
			}),
			request.method === 'POST' && !agentId ? 201 : 200,
		);
	} catch (error) {
		return routeError(error, 'Agents are temporarily unavailable.');
	}
}
