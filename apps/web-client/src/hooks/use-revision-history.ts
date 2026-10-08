'use client';
import { useEffect, useRef, useState } from 'react';
import { projectRequest } from '@/lib/projects/client';
import { isCancelled } from '@/lib/http/response';
import { usePagedCollection } from './use-paged-collection';

const identify = (item: { revision: number }) => item.revision;

export function useRevisionHistory<
	Summary extends { revision: number },
	Detail,
>(base: string) {
	const page = usePagedCollection<Summary>(`${base}/revisions`, identify);
	const [state, setState] = useState<{
		base: string;
		preview: Detail | null;
		loading: boolean;
		error: string;
	}>({ base, preview: null, loading: false, error: '' });
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), [base]);
	async function view(revision: number) {
		controller.current?.abort();
		const current = new AbortController();
		controller.current = current;
		setState(old => ({
			base,
			preview: old.base === base ? old.preview : null,
			loading: true,
			error: '',
		}));
		try {
			const preview = await projectRequest<Detail>(
				`${base}/revisions/${revision}`,
				{ signal: current.signal },
			);
			if (!current.signal.aborted)
				setState({
					base,
					preview,
					loading: false,
					error: '',
				});
		} catch (error) {
			if (!current.signal.aborted && !isCancelled(error))
				setState(old => ({
					...old,
					loading: false,
					error:
						error instanceof Error
							? error.message
							: 'Unable to load revision.',
				}));
		}
	}
	return {
		...page,
		preview: state.base === base ? state.preview : null,
		loading: page.loading || (state.base === base && state.loading),
		error: (state.base === base ? state.error : '') || page.error,
		view,
	};
}
