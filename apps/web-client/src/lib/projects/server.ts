import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ACCESS_COOKIE } from '@/lib/auth/shared';
import type { Project } from '@/types/workspace';

export class ProjectApiError extends Error {
	constructor(
		public status: number,
		message: string,
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
				signal: AbortSignal.timeout(path.includes('/tools/') && path.endsWith('/executions') ? 13_000 : 10_000),
			},
		);
	} catch {
		throw new ProjectApiError(
			503,
			errorMessages[503] ??
				'Projects are temporarily unavailable. Please try again.',
		);
	}
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
				response.status >= 500 ? 503 : response.status
			] ?? 'Unable to complete this project request.',
		);
	}
	return response.json();
}

export async function getProject(id: string, section = ''): Promise<Project> {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			id,
		)
	)
		notFound();
	try {
		return await projectApi(`/${id}`);
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
