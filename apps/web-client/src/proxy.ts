import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/shared';
import { contentSecurityPolicy } from '@/lib/security';

export function proxy(request: NextRequest) {
	const callback = request.nextUrl.pathname + request.nextUrl.search;
	const nonce = randomBytes(16).toString('base64');
	const csp = contentSecurityPolicy(
		nonce,
		process.env.NODE_ENV !== 'production',
		process.env.APP_ORIGIN?.startsWith('https://') ?? false,
	);
	let response: NextResponse;
	if (
		!request.nextUrl.pathname.startsWith('/auth/') &&
		!request.cookies.get(ACCESS_COOKIE)?.value
	) {
		const target = new URL(
			request.cookies.get(REFRESH_COOKIE)?.value
				? '/auth/refresh'
				: '/auth/signin',
			request.url,
		);
		target.searchParams.set('callbackUrl', callback);
		response = NextResponse.redirect(target);
	} else {
		const headers = new Headers(request.headers);
		// Always replace browser-supplied values before Next.js reads the nonce.
		headers.set('x-agent-path', callback);
		headers.set('x-nonce', nonce);
		headers.set('Content-Security-Policy', csp);
		response = NextResponse.next({ request: { headers } });
	}
	response.headers.set('Content-Security-Policy', csp);
	response.headers.set('Cache-Control', 'no-store');
	return response;
}
export const config = {
	matcher: ['/((?!api/|_next/|favicon.ico|robots.txt).*)'],
};
