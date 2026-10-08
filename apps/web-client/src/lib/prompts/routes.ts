import 'server-only';
import { BODY_LIMITS } from '@/lib/http/request-body';
import { json } from '@/lib/auth/server';
import { projectApi } from '@/lib/projects/server';
import {
	routeError,
	readRouteJson,
	uuidPattern as uuid,
} from '@/lib/http/project-route';

export async function promptRoute(
	request: Request,
	projectId: string,
	promptId?: string,
	revisions = false,
	revision?: string,
) {
	try {
		if (
			!uuid.test(projectId) ||
			(promptId && !uuid.test(promptId)) ||
			(revision && !/^[1-9]\d{0,8}$/.test(revision))
		)
			return json({ error: 'Prompt not found.' }, 404);
		let path = `/${projectId}/prompts${promptId ? `/${promptId}` : ''}${revisions ? '/revisions' : ''}${revision ? `/${revision}` : ''}`;
		const init: RequestInit = { method: request.method };
		if (request.method === 'GET') {
			const incoming = new URL(request.url).searchParams,
				params = new URLSearchParams();
			for (const key of ['offset', 'type', 'q'])
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
				403: 'Your project role cannot edit prompts.',
				404: 'Prompt not found or access removed.',
				409: 'A newer revision exists. Your edits are still here; copy them before reloading the latest revision.',
				422: 'Enter a name and instructions within the field limits.',
				503: 'Prompts are temporarily unavailable. Your edits have been retained.',
			}),
			request.method === 'POST' && !promptId ? 201 : 200,
		);
	} catch (error) {
		return routeError(
			error,
			'Prompts are temporarily unavailable.',
		);
	}
}
