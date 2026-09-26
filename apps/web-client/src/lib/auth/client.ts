'use client';
import { safeCallback } from './shared';

export async function withAuthLock<T>(action: () => Promise<T>): Promise<T> {
	// A single origin-wide lock serializes refresh/login/logout across browser tabs.
	if (navigator.locks)
		return navigator.locks.request('agent-auth', action);
	return action();
}
export async function ensureLogin(): Promise<Response> {
	return withAuthLock(async () => {
		const response = await fetch('/api/auth/me', {
			cache: 'no-store',
		});
		if (response.status !== 401) return response;

		// Older browsers without cross-tab locking reauthenticate instead of racing refresh rotation.
		if (!navigator.locks) return response;

		return fetch('/api/auth/refresh', { method: 'POST' });
	});
}

export function signInUrl(
	callback = window.location.pathname + window.location.search,
) {
	return `/auth/signin?error=SessionExpired&callbackUrl=${encodeURIComponent(safeCallback(callback))}`;
}
