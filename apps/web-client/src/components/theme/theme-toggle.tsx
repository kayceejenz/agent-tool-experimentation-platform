'use client';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle({ disabled = false }: { disabled?: boolean }) {
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
			type='button'
			title='Toggle color theme'
			disabled={disabled}
			onClick={toggle}
			aria-label='Toggle color theme'>
			<Sun className='sun' size={18} aria-hidden />
			<Moon className='moon' size={18} aria-hidden />
		</button>
	);
}
