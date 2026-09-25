'use client';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
	function toggle() {
		const next =
			document.documentElement.dataset.theme === 'dark'
				? 'light'
				: 'dark';
		document.documentElement.dataset.theme = next;
		try {
			localStorage.setItem('agent-platform-theme', next);
		} catch {}
	}
	return (
		<button
			className='theme-toggle'
			onClick={toggle}
			aria-label='Toggle color theme'>
			<Sun className='sun' size={18} aria-hidden />
			<Moon className='moon' size={18} aria-hidden />
			<span>Switch theme</span>
		</button>
	);
}
