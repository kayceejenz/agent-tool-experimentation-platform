import 'server-only';
import { AuthError, checkOrigin, json } from '@/lib/auth/server';
import { ProjectApiError, projectApi } from '@/lib/projects/server';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
			for (const key of ['offset', 'type'])
				if (incoming.has(key))
					params.set(key, incoming.get(key)!);
			path += `?${params}`;
		} else {
			checkOrigin(request);
			if (
				!request.headers
					.get('content-type')
					?.startsWith('application/json')
			)
				return json({ error: 'Send JSON data.' }, 415);
			const raw = await request.text();
			if (raw.length > 220000)
				return json(
					{ error: 'Prompt is too large.' },
					413,
				);
			try {
				init.body = JSON.stringify(JSON.parse(raw));
			} catch {
				return json({ error: 'Invalid JSON.' }, 400);
			}
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
		if (
			error instanceof ProjectApiError ||
			error instanceof AuthError
		)
			return json({ error: error.message }, error.status);
		return json(
			{ error: 'Prompts are temporarily unavailable.' },
			503,
		);
	}
}
