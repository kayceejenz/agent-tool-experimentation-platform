'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import {
	authFetch,
	ensureLogin,
	signInUrl,
	withAuthLock,
} from '@/lib/auth/client';
import type { AuthUser } from '@/lib/auth/shared';

export function AccountMenu({ user }: { user: AuthUser }) {
	const pathname = usePathname();
	useEffect(() => {
		if (typeof BroadcastChannel === 'undefined') return;
		const channel = new BroadcastChannel('agent-auth-events');
		channel.onmessage = event => {
			if (event.data === 'account-changed')
				window.location.reload();
			if (event.data === 'signed-out')
				window.location.replace('/auth/signin');
		};
		return () => channel.close();
	}, []);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	useEffect(() => {
		let active = true;
		let checking = false;
		const check = async () => {
			if (checking || document.visibilityState === 'hidden')
				return;
			checking = true;
			try {
				const response = await ensureLogin();
				if (active && response.ok) {
					const current = (await response.json())
						.user;
					if (
						current.id !== user.id ||
						current.display_name !==
							user.display_name ||
						current.email !== user.email
					)
						window.location.reload();
				}
				if (active && response.status === 401)
					window.location.replace(signInUrl());
			} catch {
				/* Preserve the page during temporary outages; the API still checks every request. */
			} finally {
				checking = false;
			}
		};

		void check();

		const interval = window.setInterval(() => void check(), 60_000);

		window.addEventListener('focus', check);
		document.addEventListener('visibilitychange', check);

		return () => {
			active = false;
			clearInterval(interval);
			window.removeEventListener('focus', check);
			document.removeEventListener('visibilitychange', check);
		};
	}, [pathname, user.id, user.email, user.display_name]);

	async function logout() {
		setBusy(true);
		setError('');
		try {
			await withAuthLock(async () => {
				const response = await authFetch(
					'/api/auth/logout',
					{ method: 'POST' },
				);
				if (!response.ok)
					throw new Error(
						'Sign out failed. Please try again.',
					);
			});
			if (typeof BroadcastChannel !== 'undefined') {
				const channel = new BroadcastChannel(
					'agent-auth-events',
				);
				channel.postMessage('signed-out');
				channel.close();
			}
			window.location.replace('/auth/signin');
		} catch {
			setError('Sign out failed. Please try again.');
			setBusy(false);
		}
	}
	const initials = user.display_name?.trim()
		? user.display_name
				.trim()
				.split(/\s+/)
				.slice(0, 2)
				.map(word => word[0])
				.join('')
				.toUpperCase()
		: user.email.slice(0, 2).toUpperCase();
	return (
		<div className='account-menu'>
			<div className='rail-user'>
				<div
					className='rail-user-avatar'
					title={user.display_name || user.email}
					aria-hidden>
					{initials}
				</div>
				<div className='rail-user-info'>
					<span
						className='rail-user-name'
						title={user.email}>
						{user.display_name ||
							user.email}
					</span>
					<span className='rail-user-role'>
						Workspace
					</span>
				</div>
				<button
					className='rail-user-signout'
					type='button'
					title='Sign out'
					aria-label={
						busy
							? 'Signing out…'
							: 'Sign out'
					}
					disabled={busy}
					onClick={logout}>
					<LogOut size={14} aria-hidden />
				</button>
			</div>
			{error && <small role='alert'>{error}</small>}
		</div>
	);
}
