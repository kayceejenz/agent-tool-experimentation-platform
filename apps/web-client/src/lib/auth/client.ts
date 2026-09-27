'use client';
import { safeCallback } from './shared';

export async function authFetch(
	input: RequestInfo | URL,
	init: RequestInit = {},
) {
	try {
		return await fetch(input, {
			...init,
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		throw new Error(
			'Authentication request timed out or could not connect. Please try again.',
		);
	}
}

export function notifyAuthChange() {
	if (typeof BroadcastChannel === 'undefined') return;
	const channel = new BroadcastChannel('agent-auth-events');
	channel.postMessage('account-changed');
	channel.close();
}

export async function withAuthLock<T>(action: () => Promise<T>): Promise<T> {
	// A single origin-wide lock serializes refresh/login/logout across browser tabs.
	if (navigator.locks)
		return navigator.locks
			.request(
				'agent-auth',
				{ signal: AbortSignal.timeout(20_000) },
				action,
			)
			.catch(error => {
				if (error?.name === 'TimeoutError')
					throw new Error(
						'Authentication is busy in another tab. Please try again.',
					);
				throw error;
			});
	return action();
}
export async function ensureLogin(): Promise<Response> {
	return withAuthLock(async () => {
		const response = await authFetch('/api/auth/me', {
			cache: 'no-store',
		});
		if (response.status !== 401) return response;

		// Older browsers without cross-tab locking reauthenticate instead of racing refresh rotation.
		if (!navigator.locks) return response;

		const refreshed = await authFetch('/api/auth/refresh', {
			method: 'POST',
		});
		return refreshed.ok
			? authFetch('/api/auth/me', { cache: 'no-store' })
			: refreshed;
	});
}

export function signInUrl(
	callback = window.location.pathname + window.location.search,
) {
	return `/auth/signin?error=SessionExpired&callbackUrl=${encodeURIComponent(safeCallback(callback))}`;
}
