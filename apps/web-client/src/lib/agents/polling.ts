import { HttpResponseError } from '@/lib/http/response';

export function permanentPollingError(error: unknown) {
	return (
		error instanceof HttpResponseError &&
		error.status >= 400 &&
		error.status < 500 &&
		![408, 429].includes(error.status)
	);
}

export function pollingDelay(
	failures: number,
	retryAfterMs = 0,
	random = Math.random(),
) {
	const backoff = failures
		? Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)) *
			(0.8 + random * 0.4)
		: 1000;
	return Math.max(backoff, retryAfterMs);
}
