'use client';
import { ensureLogin, signInUrl } from '@/lib/auth/client';
import {
	assertProjectPayload,
	HttpResponseError,
	isRecord,
	readJsonResponse,
	requestSignal,
	retryDelay,
} from '@/lib/http/response';

export class ProjectRequestError extends HttpResponseError {}

export async function projectRequest<T>(
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const lifetime = requestSignal(init.signal, 15_000);
	const send = () =>
		fetch(`/api/projects${path}`, {
			...init,
			cache: 'no-store',
			signal: lifetime.signal,
		});
	try {
		let response = await send();
		// Only a rejected authentication attempt is safe to automatically resend.
		if (response.status === 401) {
			const login = await ensureLogin();
			if (lifetime.signal.aborted)
				throw lifetime.signal.reason;
			if (login.status === 401) {
				window.location.replace(signInUrl());
				throw new ProjectRequestError(
					401,
					'Please sign in again.',
					'unauthenticated',
				);
			}
			if (!login.ok)
				throw new ProjectRequestError(
					503,
					'Unable to reconnect. Please try again.',
					'session_unavailable',
					retryDelay(
						login.headers.get(
							'retry-after',
						),
					),
				);
			response = await send();
		}
		const body = await readJsonResponse(response);
		if (!response.ok)
			throw new ProjectRequestError(
				response.status,
				isRecord(body) && typeof body.error === 'string'
					? body.error
					: 'Unable to complete this request.',
				isRecord(body) && typeof body.code === 'string'
					? body.code
					: 'request_failed',
				retryDelay(response.headers.get('retry-after')),
			);
		assertProjectPayload(path, body, init.method ?? 'GET');
		return body as T;
	} catch (error) {
		if (init.signal?.aborted)
			throw new DOMException(
				'Request cancelled',
				'AbortError',
			);
		if (error instanceof ProjectRequestError) throw error;
		if (error instanceof HttpResponseError)
			throw new ProjectRequestError(
				error.status,
				error.message,
				error.code,
				error.retryAfterMs,
			);
		throw new ProjectRequestError(
			503,
			'Unable to connect. Please try again.',
			lifetime.signal.aborted ? 'timeout' : 'network_error',
		);
	} finally {
		lifetime.cleanup();
	}
}

/** JSON writes use the same auth, validation, timeout and uncertain-outcome contract as reads. */
export function projectWrite<T>(
	path: string,
	method: 'POST' | 'PATCH',
	payload: unknown,
): Promise<T> {
	return projectRequest<T>(path, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	});
}
