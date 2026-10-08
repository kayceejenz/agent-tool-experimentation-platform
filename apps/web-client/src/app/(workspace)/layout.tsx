import { ProjectProvider } from '@/components/projects/project-provider';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { AuthError, currentUser } from '@/lib/auth/server';
import { REFRESH_COOKIE, safeCallback } from '@/lib/auth/shared';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({
	children,
}: {
	children: ReactNode;
}) {
	let user;
	try {
		user = await currentUser();
	} catch (error) {
		if (!(error instanceof AuthError) || error.status !== 401)
			throw new Error(
				'Unable to verify your login. Please try again.',
			);
		const callback = safeCallback(
			(await headers()).get('x-agent-path'),
		);
		const hasRefresh = (await cookies()).has(REFRESH_COOKIE);
		redirect(
			`${hasRefresh ? '/auth/refresh' : '/auth/signin'}?callbackUrl=${encodeURIComponent(callback)}&error=SessionExpired`,
		);
	}
	return (
		<ProjectProvider key={user.id} userId={user.id}>
			<AppShell user={user}>{children}</AppShell>
		</ProjectProvider>
	);
}

import '../projects.css';
import '../mcp-servers.css';
import '../tools.css';
import '../prompts.css';
import '../agents.css';
