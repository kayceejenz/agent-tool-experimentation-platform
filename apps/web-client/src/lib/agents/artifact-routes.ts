import 'server-only';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from '@/lib/auth/shared';
import { json, AuthError } from '@/lib/auth/server';
import { projectApi, ProjectApiError } from '@/lib/projects/server';
import { readJsonResponse, isRecord } from '@/lib/http/response';
import { routeError, uuidPattern } from '@/lib/http/project-route';

export async function artifactRoute(
	request: Request,
	projectId: string,
	executionId: string,
	segments: string[] = [],
) {
	try {
		const validId = /^[0-9a-f]{32}\.(png|csv|json|txt|py)$/;
		if (
			!uuidPattern.test(projectId) ||
			!uuidPattern.test(executionId) ||
			segments.length > 2 ||
			(segments.length > 0 && !validId.test(segments[0])) ||
			(segments.length === 2 && segments[1] !== 'preview')
		)
			return json({ error: 'Generated file not found.' }, 404);
		const path = `/${projectId}/executions/${executionId}/artifacts${segments.length ? '/' + segments.join('/') : ''}`;
		if (!segments.length || segments.length === 2)
			return json(
				await projectApi(
					path,
					{},
					{
						404: 'Generated file not found or access removed.',
						410: 'This file has expired. Run the analysis again.',
						422: 'This file cannot be previewed. Download it to inspect.',
					},
				),
			);
		const token = (await cookies()).get(ACCESS_COOKIE)?.value;
		if (!token)
			throw new AuthError(401, 'Your session expired. Sign in again.');
		const inline = new URL(request.url).searchParams.get('inline') === '1';
		const response = await fetch(
			`${(process.env.SERVER_API_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '')}/api/v1/projects${path}${inline ? '?inline=true' : ''}`,
			{
				headers: { Authorization: `Bearer ${token}` },
				cache: 'no-store',
				redirect: 'error',
				signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
			},
		);
		if (!response.ok) {
			const value = await readJsonResponse(response);
			throw new ProjectApiError(
				response.status,
				isRecord(value) && typeof value.detail === 'string'
					? value.detail
					: 'Generated file unavailable.',
			);
		}
		let total = 0;
		const body = response.body?.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					total += chunk.byteLength;
					if (total > 16 * 1024 * 1024)
						throw new Error('Generated file exceeds the download limit');
					controller.enqueue(chunk);
				},
			}),
		);
		return new Response(body, {
			headers: {
				'Content-Type':
					response.headers.get('content-type') ?? 'application/octet-stream',
				'Content-Disposition':
					response.headers.get('content-disposition') ?? 'attachment',
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff',
				'Content-Security-Policy': "default-src 'none'; sandbox",
			},
		});
	} catch (error) {
		return routeError(error, 'Generated files are temporarily unavailable.');
	}
}
