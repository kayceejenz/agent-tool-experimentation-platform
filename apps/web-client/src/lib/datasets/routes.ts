import 'server-only';
import { cookies } from 'next/headers';
import { appOrigin, checkOrigin, json, AuthError } from '@/lib/auth/server';
import { ACCESS_COOKIE } from '@/lib/auth/shared';
import { routeError, uuidPattern } from '@/lib/http/project-route';
import { readJsonResponse } from '@/lib/http/response';

export async function datasetRoute(
	request: Request,
	projectId: string,
	segments: string[] = [],
) {
	let size = 0;
	const limit = 129 * 1024 * 1024;
	try {
		const ticket =
			segments.length === 1 &&
			segments[0] === 'upload-ticket' &&
			request.method === 'POST';
		const validPath =
			ticket ||
			segments.length === 0 ||
			(segments.length === 1 &&
				uuidPattern.test(segments[0])) ||
			(segments.length === 4 &&
				uuidPattern.test(segments[0]) &&
				segments[1] === 'files' &&
				uuidPattern.test(segments[2]) &&
				segments[3] === 'preview');
		if (!uuidPattern.test(projectId) || !validPath)
			return json({ error: 'Dataset not found.' }, 404);
		if (request.method === 'DELETE') {
			checkOrigin(request);
			if (segments.length !== 1)
				return json(
					{ error: 'Dataset not found.' },
					404,
				);
		}
		if (request.method === 'POST') {
			checkOrigin(request);
			if (
				!ticket &&
				(segments.length ||
					!request.headers
						.get('content-type')
						?.startsWith(
							'multipart/form-data;',
						))
			)
				return json(
					{ error: 'Send a CSV dataset upload.' },
					415,
				);
		}
		const access = (await cookies()).get(ACCESS_COOKIE)?.value;
		if (!access)
			throw new AuthError(
				401,
				'Your login expired. Sign in again.',
			);
		const declared = request.headers.get('content-length');
		if (
			declared &&
			/^\d+$/.test(declared) &&
			BigInt(declared) > BigInt(limit)
		)
			return json(
				{ error: 'Dataset exceeds the upload limit.' },
				413,
			);
		const body =
			request.method === 'POST' && !ticket
				? request.body?.pipeThrough(
						new TransformStream<
							Uint8Array,
							Uint8Array
						>({
							transform(
								chunk,
								controller,
							) {
								size +=
									chunk.byteLength;
								if (
									size >
									limit
								)
									throw new Error(
										'Upload limit exceeded',
									);
								controller.enqueue(
									chunk,
								);
							},
						}),
					)
				: undefined;
		const params = new URL(request.url).searchParams;
		const query =
			!segments.length && request.method === 'GET'
				? `?offset=${encodeURIComponent(params.get('offset') ?? '0')}`
				: '';
		const response = await fetch(
			`${(process.env.SERVER_API_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '')}/api/v1/projects/${projectId}/datasets${segments.length ? '/' + segments.join('/') : ''}${query}`,
			{
				method: request.method,
				headers: {
					Authorization: `Bearer ${access}`,
					...(ticket
						? { Origin: appOrigin() }
						: {}),
					...(body
						? {
								'Content-Type':
									request.headers.get(
										'content-type',
									)!,
							}
						: {}),
				},
				body,
				duplex: 'half',
				cache: 'no-store',
				redirect: 'error',
				signal: AbortSignal.any([
					request.signal,
					AbortSignal.timeout(120_000),
				]),
			} as RequestInit & { duplex: string },
		);
		const value = (await readJsonResponse(response)) as {
			detail?: unknown;
		};
		if (response.ok) {
			return json(
				ticket
					? {
							...value,
							upload_url: `${(process.env.SERVER_API_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '')}/api/v1/projects/${projectId}/datasets/direct-upload`,
						}
					: value,
				response.status,
			);
		}
		return json(
			{
				error:
					typeof value?.detail === 'string'
						? value.detail
						: 'Dataset request failed.',
			},
			response.status,
		);
	} catch (error) {
		if (size > limit)
			return json(
				{ error: 'Dataset exceeds the upload limit.' },
				413,
			);
		return routeError(
			error,
			'Dataset request failed. Check the connection and upload size, then retry.',
		);
	}
}
