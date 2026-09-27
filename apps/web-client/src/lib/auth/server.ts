import 'server-only';
import { isIP } from 'node:net';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE, type AuthUser } from './shared';

export class AuthError extends Error {
	constructor(
		public status: number,
		message: string,
		public retryAfter?: string,
	) {
		super(message);
	}
}

export function appOrigin() {
	const url = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3001');
	if (
		url.protocol !== 'https:' &&
		!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
	)
		throw new AuthError(
			503,
			'Authentication configuration unavailable.',
		);

	return url.origin;
}
export function checkOrigin(request: Request) {
	if (request.headers.get('origin') !== appOrigin())
		throw new AuthError(
			403,
			'This request could not be verified. Reload the page and try again.',
		);
}

export function json(data: unknown, status = 200) {
	return NextResponse.json(data, {
		status,
		headers: { 'Cache-Control': 'no-store' },
	});
}

export function authFailure(error: unknown) {
	const response =
		error instanceof AuthError
			? json({ error: error.message }, error.status)
			: json(
					{
						error: 'Authentication is temporarily unavailable. Please try again.',
					},
					503,
				);
	if (error instanceof AuthError && error.retryAfter)
		response.headers.set('Retry-After', error.retryAfter);
	return response;
}

export async function backend(path: string, init: RequestInit = {}) {
	let response: Response;
	try {
		response = await fetch(
			`${(process.env.SERVER_API_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '')}/api/v1/auth/${path}`,
			{
				...init,
				cache: 'no-store',
				signal: AbortSignal.timeout(10_000),
				redirect: 'error',
			},
		);
	} catch {
		throw new AuthError(
			503,
			'Authentication is temporarily unavailable. Please try again.',
		);
	}
	if (!response.ok) {
		const messages: Record<number, string> = {
			401:
				path === 'login'
					? 'The email or password is incorrect.'
					: 'Your session expired. Sign in again to continue.',
			403: 'The invitation code is incorrect.',
			409: 'An account with this email already exists.',
			422: 'Check your details. Passwords must contain at least 12 characters.',
			429: 'Too many attempts. Please wait before trying again.',
		};

		throw new AuthError(
			response.status >= 500 ? 503 : response.status,
			messages[response.status] ??
				'Unable to complete this request.',
			response.headers.get('retry-after') ?? undefined,
		);
	}
	return response;
}

export async function readUser(access: string): Promise<AuthUser> {
	const response = await backend('me', {
		headers: { Authorization: `Bearer ${access}` },
	});
	return response.json();
}

export async function currentUser(): Promise<AuthUser> {
	const access = (await cookies()).get(ACCESS_COOKIE)?.value;

	if (!access) throw new AuthError(401, 'Not authenticated.');

	return readUser(access);
}

export type Tokens = {
	access: string;
	refresh: string;
	expiresIn: number;
	refreshMaxAge: number;
};

export async function readTokens(response: Response): Promise<Tokens> {
	const body = await response.json();
	const header = response.headers.get('set-cookie') ?? '';
	const refresh = /(?:^|[,;]\s*)agent_refresh_token=([^;,]+)/.exec(
		header,
	)?.[1];
	const maxAge = /max-age=(\d+)/i.exec(header)?.[1];
	if (
		!refresh ||
		typeof body.access_token !== 'string' ||
		!Number.isFinite(body.expires_in) ||
		body.expires_in <= 0 ||
		!maxAge
	)
		throw new AuthError(
			503,
			'Authentication returned an invalid response.',
		);
	return {
		access: body.access_token,
		refresh,
		expiresIn: body.expires_in,
		refreshMaxAge: Number(maxAge),
	};
}

export function setTokens(response: NextResponse, tokens: Tokens) {
	const options = {
		httpOnly: true,
		secure: appOrigin().startsWith('https:'),
		sameSite: 'strict' as const,
		path: '/',
	};
	response.cookies.set(ACCESS_COOKIE, tokens.access, {
		...options,
		maxAge: tokens.expiresIn,
	});
	response.cookies.set(REFRESH_COOKIE, tokens.refresh, {
		...options,
		maxAge: tokens.refreshMaxAge,
	});
}

export function clearTokens(response: NextResponse) {
	for (const name of [ACCESS_COOKIE, REFRESH_COOKIE])
		response.cookies.set(name, '', {
			httpOnly: true,
			secure: appOrigin().startsWith('https:'),
			sameSite: 'strict',
			path: '/',
			maxAge: 0,
		});
}

// Configure only a header overwritten by a trusted ingress, never arbitrary browser input.
export function clientAddressHeaders(request: Request): Record<string, string> {
	const secret = process.env.AUTH_PROXY_SECRET;
	const header = process.env.AUTH_CLIENT_IP_HEADER;
	if (!secret || secret.length < 32 || (process.env.NODE_ENV === 'production' && !header && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(appOrigin()).hostname)))
		throw new AuthError(503, 'Authentication proxy configuration unavailable.');
	const address = header ? request.headers.get(header)?.trim() : '127.0.0.1';
	if (!address || !isIP(address)) throw new AuthError(503, 'Authentication client address unavailable.');
	return { 'X-Agent-Proxy-Secret': secret, 'X-Agent-Client-IP': address };
}
