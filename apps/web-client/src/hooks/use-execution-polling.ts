'use client';
import { useCallback, useEffect, useState } from 'react';
import { projectRequest } from '@/lib/projects/client';
import { HttpResponseError, isCancelled } from '@/lib/http/response';
import { permanentPollingError, pollingDelay } from '@/lib/agents/polling';
import type { ExecutionStatus } from '@/types/execution';

export function useExecutionPolling(
	path: string | null,
	pending: boolean,
	onUpdate: (value: ExecutionStatus) => void,
	onFinished: () => void,
) {
	const [error, setError] = useState('');
	const [stopped, setStopped] = useState(false);
	const [generation, setGeneration] = useState(0);

	const reconnect = useCallback(() => {
		setError('');
		setStopped(false);
		setGeneration(value => value + 1);
	}, []);

	useEffect(() => {
		if (!path || !pending) return;
		let failures = 0,
			terminal = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let request: AbortController | null = null;
		let active = true;

		const available = () =>
			document.visibilityState !== 'hidden' &&
			navigator.onLine;

		function schedule(delay: number) {
			if (!active || terminal || !available()) return;
			clearTimeout(timer);
			timer = setTimeout(() => void poll(), delay);
		}

		async function poll() {
			if (!active || terminal || !available() || request)
				return;
			request = new AbortController();
			let delay = 1000;
			try {
				const value =
					await projectRequest<ExecutionStatus>(
						`${path}?view=status`,
						{ signal: request.signal },
					);
				if (!active) return;
				failures = 0;
				setError('');
				setStopped(false);
				onUpdate(value);
				if (
					!['queued', 'running'].includes(
						value.status,
					)
				) {
					terminal = true;
					onFinished();
				}
			} catch (error) {
				if (!active || isCancelled(error)) return;
				setError(
					error instanceof Error
						? error.message
						: 'Unable to check execution.',
				);
				terminal =
					permanentPollingError(error) ||
					++failures >= 8;
				if (terminal) setStopped(true);
				delay = pollingDelay(
					failures,
					error instanceof HttpResponseError
						? error.retryAfterMs
						: undefined,
				);
			} finally {
				request = null;
				schedule(delay);
			}
		}

		function resume() {
			clearTimeout(timer);
			if (!available()) request?.abort();
			else schedule(0);
		}

		document.addEventListener('visibilitychange', resume);
		window.addEventListener('online', resume);
		window.addEventListener('offline', resume);
		schedule(1000);

		return () => {
			active = false;
			clearTimeout(timer);
			request?.abort();
			document.removeEventListener(
				'visibilitychange',
				resume,
			);
			window.removeEventListener('online', resume);
			window.removeEventListener('offline', resume);
		};
	}, [path, pending, generation, onUpdate, onFinished]);

	return {
		error: pending ? error : '',
		stopped: pending && stopped,
		reconnect,
	};
}
