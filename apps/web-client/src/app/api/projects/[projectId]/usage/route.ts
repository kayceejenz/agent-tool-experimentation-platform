import { json } from '@/lib/auth/server';
import { projectApi } from '@/lib/projects/server';
import { routeError } from '@/lib/http/project-route';
export async function GET(
	_request: Request,
	context: { params: Promise<{ projectId: string }> },
) {
	try {
		const { projectId } = await context.params;
		if (!/^[0-9a-f-]{36}$/i.test(projectId))
			return json({ error: 'Project not found.' }, 404);
		return json(
			await projectApi(
				`/${projectId}/usage`,
				{},
				{
					404: 'Usage is unavailable. The API may need restarting to load the usage endpoint, or project access may have changed.',
				},
			),
		);
	} catch (error) {
		return routeError(
			error,
			'Usage could not be loaded. Please try again.',
		);
	}
}
