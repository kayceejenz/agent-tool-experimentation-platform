import 'server-only';
import { BODY_LIMITS } from '@/lib/http/request-body';
import { json } from '@/lib/auth/server';
import { projectApi } from './server';
import { routeError, readRouteJson } from '@/lib/http/project-route';

export async function projectRoute(request: Request, id?: string) {
	try {
		if (id && !/^[0-9a-f-]{36}$/i.test(id))
			return json({ error: 'Project not found.' }, 404);
		let path = id ? `/${id}` : '';
		const init: RequestInit = { method: request.method };
		if (request.method === 'GET' && !id) {
			const input = new URL(request.url).searchParams;
			const params = new URLSearchParams({ limit: '50' });
			if (input.has('cursor'))
				params.set('cursor', input.get('cursor')!);
			path += `?${params}`;
		} else if (request.method !== 'GET') {
			init.body = await readRouteJson(
				request,
				BODY_LIMITS.project,
				'Send JSON form data.',
			);
		}
		return json(
			await projectApi(path, init),
			request.method === 'POST' ? 201 : 200,
		);
	} catch (error) {
		return routeError(
			error,
			'Projects are temporarily unavailable. Please try again.',
		);
	}
}
