import { cookies } from 'next/headers';
import {
	AuthError,
	authFailure,
	backend,
	checkOrigin,
	clearTokens,
	currentUser,
	json,
	readTokens,
	readUser,
	setTokens,
} from '@/lib/auth/server';
import { REFRESH_COOKIE } from '@/lib/auth/shared';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ action: string }> };

export async function GET(_request: Request, context: Context) {
	if ((await context.params).action !== 'me')
		return json({ error: 'Not found.' }, 404);
	try {
		return json({ user: await currentUser() });
	} catch (error) {
		return authFailure(error);
	}
}

export async function POST(request: Request, context: Context) {
	const { action } = await context.params;
	if (!['login', 'register', 'refresh', 'logout'].includes(action))
		return json({ error: 'Not found.' }, 404);
	try {
		checkOrigin(request);
		if (action === 'login' || action === 'register') {
			if (
				!request.headers
					.get('content-type')
					?.startsWith('application/json')
			)
				throw new AuthError(
					415,
					'Send JSON form data.',
				);
			let input: Record<string, unknown>;
			try {
				input = await request.json();
			} catch {
				throw new AuthError(400, 'Invalid form data.');
			}
			if (
				!input ||
				typeof input.email !== 'string' ||
				typeof input.password !== 'string' ||
				!input.email ||
				!input.password
			)
				throw new AuthError(
					400,
					'Email and password are required.',
				);

			const body = {
				email: input.email.trim().toLowerCase(),
				password: input.password,
				...(action === 'register'
					? {
							display_name:
								input.display_name ??
								null,
							invitation_code:
								input.invitation_code ??
								null,
						}
					: {}),
			};

			const result = await backend(action, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

			if (action === 'register')
				return json({ user: await result.json() }, 201);

			const tokens = await readTokens(result);

			const response = json({
				user: await readUser(tokens.access),
			});

			setTokens(response, tokens);
			return response;
		}

		const refresh = (await cookies()).get(REFRESH_COOKIE)?.value;
		if (action === 'logout') {
			if (refresh)
				await backend('logout', {
					method: 'POST',
					headers: {
						Cookie: `agent_refresh_token=${refresh}`,
					},
				});

			const response = json({ ok: true });
			clearTokens(response);

			return response;
		}

		if (!refresh)
			throw new AuthError(
				401,
				'Your session expired. Sign in again to continue.',
			);

		const tokens = await readTokens(
			await backend('refresh', {
				method: 'POST',
				headers: {
					Cookie: `agent_refresh_token=${refresh}`,
				},
			}),
		);

		const response = json({ user: await readUser(tokens.access) });
		setTokens(response, tokens);

		return response;
	} catch (error) {
		const response = authFailure(error);

		if (
			action === 'refresh' &&
			error instanceof AuthError &&
			error.status === 401
		)
			clearTokens(response);

		return response;
	}
}
