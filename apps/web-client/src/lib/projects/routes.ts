import 'server-only';
import { AuthError, checkOrigin, json } from '@/lib/auth/server';
import { ProjectApiError, projectApi } from './server';

export async function projectRoute(request: Request, id?: string) {
	try {
		if (id && !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Project not found.' }, 404);
		let path = id ? `/${id}` : '';
		const init: RequestInit = { method: request.method };
		if (request.method === 'GET' && !id) {
			const input = new URL(request.url).searchParams;
			const params = new URLSearchParams({ limit: '50' });
			if (input.has('cursor')) params.set('cursor', input.get('cursor')!);
			path += `?${params}`;
		} else if (request.method !== 'GET') {
			checkOrigin(request);
			if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send JSON form data.' }, 415);
			let body;
			try { body = await request.json(); } catch { return json({ error: 'Invalid form data.' }, 400); }
			init.body = JSON.stringify(body);
		}
		return json(await projectApi(path, init), request.method === 'POST' ? 201 : 200);
	} catch (error) {
		if (error instanceof ProjectApiError || error instanceof AuthError) return json({ error: error.message }, error.status);
		return json({ error: 'Projects are temporarily unavailable. Please try again.' }, 503);
	}
}
