import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/shared';

export function proxy(request: NextRequest) {
	const callback = request.nextUrl.pathname + request.nextUrl.search;

	if (!request.cookies.get(ACCESS_COOKIE)?.value) {
		const target = new URL(
			request.cookies.get(REFRESH_COOKIE)?.value
				? '/auth/refresh'
				: '/auth/signin',
			request.url,
		);

		target.searchParams.set('callbackUrl', callback);

		return NextResponse.redirect(target);
	}

	const headers = new Headers(request.headers);

	headers.set('x-agent-path', callback);

	return NextResponse.next({ request: { headers } });
}

export const config = {
	matcher: ['/((?!api/|auth/|_next/|favicon.ico|robots.txt).*)'],
};
