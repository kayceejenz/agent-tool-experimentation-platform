'use client';
import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { AccountMenu } from '@/components/auth/account-menu';
import type { AuthUser } from '@/lib/auth/shared';
import { WorkspaceNavigation } from '@/components/navigation/workspace-navigation';
import { ThemeToggle } from '@/components/theme/theme-toggle';

export function AppShell({
	children,
	user,
}: {
	children: ReactNode;
	user: AuthUser;
}) {
	const [open, setOpen] = useState(false);
	const menuButton = useRef<HTMLButtonElement>(null);
	function close() {
		setOpen(false);
		menuButton.current?.focus();
	}
	return (
		<div className='app-shell'>
			<a className='skip-link' href='#workspace'>
				Skip to content
			</a>
			<aside
				className='rail'
				aria-label='Primary'
				onKeyDown={event => {
					if (event.key === 'Escape' && open)
						close();
				}}>
				<div className='rail-top'>
					<Link
						className='rail-brand'
						href='/'
						onClick={() => setOpen(false)}>
						kayceejenz.ai <span>Agent</span>
					</Link>
					<button
						ref={menuButton}
						className='mobile-menu-button'
						aria-label={
							open
								? 'Close workspace navigation'
								: 'Open workspace navigation'
						}
						aria-expanded={open}
						aria-controls='rail-content'
						onClick={() => setOpen(!open)}>
						{open ? (
							<X size={21} />
						) : (
							<Menu size={21} />
						)}
						<span>Menu</span>
					</button>
				</div>
				<div
					id='rail-content'
					className={`rail-content${open ? ' is-open' : ''}`}>
					<WorkspaceNavigation
						onNavigate={() => {
							if (open) close();
						}}
					/>
				</div>
				<div className='rail-footer'>
					<ThemeToggle />
					<AccountMenu user={user} />
				</div>
			</aside>
			<main
				id='workspace'
				className='workspace'
				tabIndex={-1}>
				{children}
			</main>
		</div>
	);
}
