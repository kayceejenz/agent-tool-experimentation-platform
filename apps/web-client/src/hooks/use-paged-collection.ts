'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { projectRequest } from '@/lib/projects/client';
import { isCancelled } from '@/lib/http/response';

type Page<T> = { items: T[]; next_offset: number | null };

export function usePagedCollection<T>(
	path: string,
	identity: (item: T) => string | number,
) {
	const [state, setState] = useState<{
		path: string;
		page: Page<T>;
		error: string;
		loading: boolean;
	}>({
		path: '',
		page: { items: [], next_offset: null },
		error: '',
		loading: true,
	});
	const controller = useRef<AbortController | null>(null);
	const loadingMore = useRef(false);

	useEffect(() => {
		const current = new AbortController();
		controller.current = current;

		void projectRequest<Page<T>>(path, { signal: current.signal })
			.then(page => {
				if (!current.signal.aborted)
					setState({
						path,
						page,
						error: '',
						loading: false,
					});
			})
			.catch(error => {
				if (
					!current.signal.aborted &&
					!isCancelled(error)
				)
					setState({
						path,
						page: {
							items: [],
							next_offset: null,
						},
						error: error.message,
						loading: false,
					});
			});
		return () => current.abort();
	}, [path]);

	const loading = state.path !== path || state.loading;

	const more = useCallback(async () => {
		if (
			loading ||
			loadingMore.current ||
			state.page.next_offset === null
		)
			return;
		const current = controller.current;
		if (!current || current.signal.aborted) return;
		loadingMore.current = true;
		setState(old => ({ ...old, loading: true, error: '' }));
		try {
			const page = await projectRequest<Page<T>>(
				`${path}${path.includes('?') ? '&' : '?'}offset=${state.page.next_offset}`,
				{ signal: current.signal },
			);
			if (!current.signal.aborted)
				setState(old => ({
					path,
					error: '',
					loading: false,
					page: {
						items: [
							...new Map(
								[
									...old
										.page
										.items,
									...page.items,
								].map(item => [
									identity(
										item,
									),
									item,
								]),
							).values(),
						],
						next_offset: page.next_offset,
					},
				}));
		} catch (error) {
			if (!current.signal.aborted && !isCancelled(error))
				setState(old => ({
					...old,
					error:
						error instanceof Error
							? error.message
							: 'Unable to load choices.',
					loading: false,
				}));
		} finally {
			loadingMore.current = false;
		}
	}, [path, loading, state.page.next_offset, identity]);
	return {
		items: state.path === path ? state.page.items : [],
		more,
		hasMore: state.path === path && state.page.next_offset !== null,
		loading,
		error: state.path === path ? state.error : '',
	};
}
