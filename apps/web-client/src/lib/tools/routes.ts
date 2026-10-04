import 'server-only';
import { AuthError, checkOrigin, json } from '@/lib/auth/server';
import { ProjectApiError, projectApi } from '@/lib/projects/server';


const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
			for (const key of ['server_id', 'offset'])
				if (incoming.has(key))
					params.set(key, incoming.get(key)!);
			path += `?${params}`;
		} else if (request.method !== 'GET') {
			checkOrigin(request);
			if (
				!request.headers
					.get('content-type')
					?.startsWith('application/json')
			)
				return json({ error: 'Send JSON data.' }, 415);
			const raw = await request.text();
			if (raw.length > 70000)
				return json(
					{ error: 'Inputs exceed 64 KB.' },
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
				403: 'Your role cannot manage or test tools.',
				404: 'Tool not found or access removed.',
				409: 'Tool changed or is disabled. Refresh and enable the server and tool before testing.',
				422: 'Inputs do not match the schema, or the schema is unsupported. Review the input schema.',
				503: 'Unable to complete the request. Check test history before running again.',
			}),
		);
	} catch (error) {
		if (
			error instanceof ProjectApiError ||
			error instanceof AuthError
		)
			return json({ error: error.message }, error.status);
		return json(
			{
				error: 'Tools are temporarily unavailable. Check history before running again.',
			},
			503,
		);
	}
}
