'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { ensureLogin, signInUrl, withAuthLock } from '@/lib/auth/client';
import type { AuthUser } from '@/lib/auth/shared';

export function AccountMenu({ user }: { user: AuthUser }) {
	const pathname = usePathname();
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
	}, [pathname]);

	async function logout() {
		setBusy(true);
		setError('');
		try {
			await withAuthLock(async () => {
				const response = await fetch(
					'/api/auth/logout',
					{ method: 'POST' },
				);
				if (!response.ok)
					throw new Error(
						'Sign out failed. Please try again.',
					);
			});
			window.location.replace('/auth/signin');
		} catch {
			setError('Sign out failed. Please try again.');
			setBusy(false);
		}
	}
	return (
		<div className='account-menu'>
			<div className='account-identity'>
				<strong>
					{user.display_name || user.email}
				</strong>
				<span>{user.email}</span>
			</div>
			<button
				className='account-signout'
				disabled={busy}
				onClick={logout}>
				<LogOut size={16} aria-hidden />
				{busy ? 'Signing out…' : 'Sign out'}
			</button>
			{error && <small role='alert'>{error}</small>}
		</div>
	);
}
