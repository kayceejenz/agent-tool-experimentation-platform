import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { AuthError, currentUser } from '@/lib/auth/server';
import { REFRESH_COOKIE, safeCallback } from '@/lib/auth/shared';

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
	let user;
	try { user = await currentUser(); }
	catch (error) {
		if (!(error instanceof AuthError) || error.status !== 401) throw new Error('Unable to verify your login. Please try again.');
		const callback = safeCallback((await headers()).get('x-agent-path'));
		const hasRefresh = (await cookies()).has(REFRESH_COOKIE);
		redirect(`${hasRefresh ? '/auth/refresh' : '/auth/signin'}?callbackUrl=${encodeURIComponent(callback)}&error=SessionExpired`);
	}
	return <AppShell user={user}>{children}</AppShell>;
}
