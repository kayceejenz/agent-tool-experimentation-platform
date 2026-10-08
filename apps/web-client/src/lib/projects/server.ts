import 'server-only';
import {
	assertProjectPayload,
	HttpResponseError,
	readJsonResponse,
	requestSignal,
} from '@/lib/http/response';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ACCESS_COOKIE } from '@/lib/auth/shared';
import type { Project } from '@/types/workspace';

export class ProjectApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public retryAfter?: string,
		public code = 'request_failed',
	) {
		super(message);
	}
}

export async function projectApi(
	path = '',
	init: RequestInit = {},
	errorMessages: Record<number, string> = {},
) {
	const access = (await cookies()).get(ACCESS_COOKIE)?.value;
	if (!access)
		throw new ProjectApiError(
			401,
			'Your login expired. Sign in again.',
		);
	const lifetime = requestSignal(
		init.signal,
		path.includes('/tools/') && path.endsWith('/executions')
			? 13_000
			: 10_000,
	);
	let response: Response;
	try {
		response = await fetch(
			`${(process.env.SERVER_API_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '')}/api/v1/projects${path}`,
			{
				...init,
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${access}`,
				},
				cache: 'no-store',
				redirect: 'error',
				signal: lifetime.signal,
			},
		);
	} catch {
		lifetime.cleanup();
		throw new ProjectApiError(
			503,
			errorMessages[503] ??
				'Projects are temporarily unavailable. Please try again.',
		);
	}
	try {
		if (!response.ok) {
			const messages: Record<number, string> = {
				401: 'Your login expired. Sign in again.',
				403: 'You no longer have permission to edit this project.',
				404: 'Project not found or you no longer have access.',
				422: 'Check the project name and description and try again.',
				...errorMessages,
			};
			throw new ProjectApiError(
				response.status >= 500 ? 503 : response.status,
				messages[
					response.status >= 500
						? 503
						: response.status
				] ?? 'Unable to complete this project request.',
				response.headers.get('retry-after') ??
					undefined,
			);
		}
		const value = await readJsonResponse(response);
		assertProjectPayload(path, value, init.method ?? 'GET');
		return value;
	} catch (error) {
		if (error instanceof HttpResponseError)
			throw new ProjectApiError(
				error.status,
				error.message,
				response.headers.get('retry-after') ??
					undefined,
				error.code,
			);
		throw error;
	} finally {
		lifetime.cleanup();
	}
}

export async function getProject(id: string, section = ''): Promise<Project> {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			id,
		)
	)
		notFound();
	try {
		const value = await projectApi(`/${id}`);
		if (
			![
				'id',
				'name',
				'created_by',
				'created_at',
				'updated_at',
			].every(key => typeof value[key] === 'string') ||
			!['owner', 'editor', 'viewer'].includes(
				String(value.role),
			) ||
			(value.description !== null &&
				typeof value.description !== 'string')
		)
			throw new ProjectApiError(
				503,
				'The server returned an invalid project.',
				undefined,
				'invalid_response',
			);
		return value as Project;
	} catch (error) {
		if (error instanceof ProjectApiError) {
			if (error.status === 404) notFound();
			if (error.status === 401)
				redirect(
					`/auth/refresh?callbackUrl=${encodeURIComponent(`/projects/${id}${section ? `/${section}` : ''}`)}`,
				);
		}
		throw error;
	}
}
