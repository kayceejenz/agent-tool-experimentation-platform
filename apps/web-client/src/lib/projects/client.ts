'use client';
import { ensureLogin, signInUrl } from '@/lib/auth/client';

export class ProjectRequestError extends Error {
	constructor(public status: number, message: string) { super(message); }
}
export async function projectRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
	const send = () => fetch(`/api/projects${path}`, { ...init, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
	let response: Response;
	try {
		response = await send();
		// A 401 rejects the operation before any project write; only that case is retried.
		if (response.status === 401) {
			const login = await ensureLogin();
			if (login.status === 401) { window.location.replace(signInUrl()); throw new ProjectRequestError(401, 'Please sign in again.'); }
			if (!login.ok) throw new ProjectRequestError(503, 'Unable to reconnect. Please try again.');
			response = await send();
		}
	} catch (error) {
		if (error instanceof ProjectRequestError) throw error;
		throw new ProjectRequestError(503, 'Unable to connect. Please try again.');
	}
	const body = await response.json();
	if (!response.ok) throw new ProjectRequestError(response.status, body.error ?? 'Unable to complete this request.');
	return body as T;
}
