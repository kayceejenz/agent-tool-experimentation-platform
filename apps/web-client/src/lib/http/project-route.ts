import 'server-only';
import { AuthError, checkOrigin, json } from '@/lib/auth/server';
import { ProjectApiError } from '@/lib/projects/server';
import { readBoundedJson, RequestBodyError } from './request-body';

class RouteInputError extends Error {
	readonly status = 415;
}

/** Shared transport policy; resource paths, limits and messages belong to each route. */
export async function readRouteJson(
	request: Request,
	limit: number,
	message = 'Send JSON data.',
) {
	checkOrigin(request);
	if (
		!request.headers
			.get('content-type')
			?.startsWith('application/json')
	)
		throw new RouteInputError(message);
	return JSON.stringify(await readBoundedJson(request, limit));
}

export function routeError(error: unknown, fallback: string) {
	if (
		error instanceof ProjectApiError ||
		error instanceof AuthError ||
		error instanceof RequestBodyError ||
		error instanceof RouteInputError
	)
		return json(
			{ error: error.message },
			error.status,
			error instanceof ProjectApiError
				? error.retryAfter
				: undefined,
		);
	return json({ error: fallback }, 503);
}

export const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
