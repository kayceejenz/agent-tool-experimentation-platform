import 'server-only';
import { AuthError, checkOrigin, json } from '@/lib/auth/server';
import { ProjectApiError, projectApi } from '@/lib/projects/server';

export async function executionRoute(request: Request, projectId: string, id: string, mode: 'agent' | 'detail' | 'cancel') {
	const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (!uuid.test(projectId) || !uuid.test(id)) return json({ error: 'Execution not found.' }, 404);
	try {
		let path = `/${projectId}/${mode === 'agent' ? `agents/${id}/executions` : `executions/${id}${mode === 'cancel' ? '/cancel' : ''}`}`;
		const init: RequestInit = { method: request.method };
		if (request.method === 'GET') {
			const offset = new URL(request.url).searchParams.get('offset');
			if (offset !== null) path += `?offset=${encodeURIComponent(offset)}`;
		} else {
			checkOrigin(request);
			if (mode === 'agent') {
				if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send JSON data.' }, 415);
				const raw = await request.text();
				if (raw.length > 70000) return json({ error: 'Task is too large.' }, 413);
				try { init.body = JSON.stringify(JSON.parse(raw)); }
				catch { return json({ error: 'Invalid JSON.' }, 400); }
			}
		}
		return json(await projectApi(path, init, {
			403: 'Your role cannot run or cancel agents.',
			404: 'Execution not found or access removed.',
			409: 'Enable the current agent revision and its tools, or wait for pending runs to finish.',
			422: 'Check the task and select an OpenAI agent configuration.',
			503: 'Execution unavailable. Configure AGENT_OPENAI_API_KEY on the server and start the worker.',
		}), request.method === 'POST' && mode === 'agent' ? 202 : 200);
	} catch (error) {
		if (error instanceof ProjectApiError || error instanceof AuthError) return json({ error: error.message }, error.status);
		return json({ error: 'Executions are temporarily unavailable.' }, 503);
	}
}
