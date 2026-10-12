'use client';
import { useEffect } from 'react';

export function useUnsavedChanges(
	dirty: boolean,
	onNavigate?: (href: string) => void,
) {
	useEffect(() => {
		if (!dirty) return;
		const prevent = (event: BeforeUnloadEvent) =>
			event.preventDefault();
		window.addEventListener('beforeunload', prevent);
		const intercept = (event: MouseEvent) => {
			if (
				!onNavigate ||
				event.defaultPrevented ||
				event.button !== 0 ||
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.shiftKey
			)
				return;
			const anchor =
				event.target instanceof Element
					? event.target.closest('a')
					: null;
			if (
				!anchor ||
				anchor.target === '_blank' ||
				anchor.hasAttribute('download')
			)
				return;
			const target = new URL(
				anchor.href,
				window.location.href,
			);
			if (
				target.origin !== window.location.origin ||
				(target.pathname === window.location.pathname &&
					target.search ===
						window.location.search)
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			onNavigate(
				target.pathname + target.search + target.hash,
			);
		};
		document.addEventListener('click', intercept, true);
		return () => {
			window.removeEventListener('beforeunload', prevent);
			document.removeEventListener('click', intercept, true);
		};
	}, [dirty, onNavigate]);
}
