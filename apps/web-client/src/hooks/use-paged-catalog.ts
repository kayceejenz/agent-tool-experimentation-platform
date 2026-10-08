'use client';
import { useEffect, useState } from 'react';
import { usePagedCollection } from './use-paged-collection';

const identify = (item: { id: string }) => item.id;

export function usePagedCatalog<T extends { id: string }>(path: string) {
	return usePagedCollection<T>(path, identify);
}

export function useDebouncedValue(value: string, delay = 250) {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);
	return debounced;
}
