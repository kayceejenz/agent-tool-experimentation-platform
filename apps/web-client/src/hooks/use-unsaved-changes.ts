'use client';
import { useEffect } from 'react';

export function useUnsavedChanges(dirty: boolean) {
	useEffect(() => {
		if (!dirty) return;
		const prevent = (event: BeforeUnloadEvent) =>
			event.preventDefault();
		window.addEventListener('beforeunload', prevent);
		return () =>
			window.removeEventListener('beforeunload', prevent);
	}, [dirty]);
}
