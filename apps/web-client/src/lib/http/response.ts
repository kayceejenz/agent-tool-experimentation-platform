export class HttpResponseError extends Error {
	constructor(
		public status: number,
		message: string,
		public code = 'request_failed',
		public retryAfterMs?: number,
	) {
		super(message);
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function retryDelay(
	value: string | null,
	now = Date.now(),
): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	const delay =
		Number.isFinite(seconds) && seconds >= 0
			? seconds * 1000
			: Date.parse(value) - now;
	return Number.isFinite(delay) && delay >= 0 ? delay : undefined;
}

export function requestSignal(
	caller: AbortSignal | null | undefined,
	timeoutMs: number,
) {
	const controller = new AbortController();
	const abort = () => controller.abort(caller?.reason);
	if (caller?.aborted) abort();
	else caller?.addEventListener('abort', abort, { once: true });
	const timer = setTimeout(
		() =>
			controller.abort(
				new DOMException(
					'Request timed out',
					'TimeoutError',
				),
			),
		timeoutMs,
	);
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timer);
			caller?.removeEventListener('abort', abort);
		},
	};
}

export function isCancelled(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

export async function readJsonResponse(response: Response): Promise<unknown> {
	if (
		!response.headers
			.get('content-type')
			?.toLowerCase()
			.includes('application/json')
	)
		throw new HttpResponseError(
			503,
			'The server returned an invalid response. Please try again.',
			'invalid_response',
			retryDelay(response.headers.get('retry-after')),
		);
	try {
		return await response.json();
	} catch (error) {
		if (isCancelled(error)) throw error;
		throw new HttpResponseError(
			503,
			'The server returned an invalid response. Please try again.',
			'invalid_response',
			retryDelay(response.headers.get('retry-after')),
		);
	}
}

/** Runtime checks for envelopes used by critical execution and catalog views. */
export function assertProjectPayload(
	path: string,
	value: unknown,
	method = 'GET',
): asserts value is Record<string, unknown> {
	const invalid = () => {
		throw new HttpResponseError(
			503,
			'The server returned an invalid response. Please try again.',
			'invalid_response',
		);
	};
	if (!isRecord(value)) return invalid();
	const url = new URL(path || '/', 'https://contracts.invalid');
	const route = url.pathname;
	const positive = (v: unknown) => Number.isInteger(v) && Number(v) > 0;
	const text = (v: unknown) => typeof v === 'string' && v.length > 0;
	const catalog =
		/\/(tools|prompts|spans)$/.test(route) && method === 'GET';
	if (catalog && !('items' in value)) return invalid();
	if ('items' in value) {
		if (
			!Array.isArray(value.items) ||
			!value.items.every(
				item => isRecord(item) && text(item.id),
			)
		)
			return invalid();
		if (
			'next_offset' in value &&
			value.next_offset !== null &&
			(!Number.isInteger(value.next_offset) ||
				Number(value.next_offset) < 0)
		)
			return invalid();
		if (/\/(tools|prompts)$/.test(route) && method === 'GET') {
			if (!('next_offset' in value)) return invalid();
			for (const item of value.items) {
				if (
					!isRecord(item) ||
					!text(item.name) ||
					!positive(item.revision)
				)
					return invalid();
				if (
					route.endsWith('/tools') &&
					(!text(item.server_id) ||
						typeof item.enabled !==
							'boolean' ||
						typeof item.available !==
							'boolean')
				)
					return invalid();
			}
		}
		if (
			route.endsWith('/spans') &&
			!value.items.every(
				item =>
					isRecord(item) &&
					['model', 'tool'].includes(
						String(item.kind),
					) &&
					positive(item.sequence) &&
					typeof item.name === 'string' &&
					typeof item.status === 'string' &&
					Array.isArray(item.context_span_ids),
			)
		)
			return invalid();
		return;
	}
	if (/\/executions\/[^/]+(?:\/cancel)?$/.test(route)) {
		if (
			!text(value.id) ||
			![
				'queued',
				'running',
				'completed',
				'failed',
				'cancelled',
				'interrupted',
			].includes(String(value.status))
		)
			return invalid();
		if (
			!('final_answer' in value) ||
			(value.final_answer !== null &&
				typeof value.final_answer !== 'string')
		)
			return invalid();
		if (
			url.searchParams.get('view') !== 'status' &&
			typeof value.input !== 'string'
		)
			return invalid();
		if ('spans' in value && !Array.isArray(value.spans))
			return invalid();
		if (
			url.searchParams.has('view') &&
			(!Number.isInteger(value.model_turns) ||
				Number(value.model_turns) < 0 ||
				!Number.isInteger(value.tool_calls) ||
				Number(value.tool_calls) < 0 ||
				(value.failure_hint !== null &&
					typeof value.failure_hint !== 'string'))
		)
			return invalid();
	} else if (
		/\/agents\/[^/]+\/executions$/.test(route) &&
		method === 'POST'
	) {
		if (!text(value.id) || !text(value.status)) return invalid();
	} else if (
		(/\/tools\/[^/]+\/executions$/.test(route) &&
			method === 'POST') ||
		/\/tools\/[^/]+\/executions\/requests\/[^/]+$/.test(route)
	) {
		if (
			!text(value.id) ||
			!positive(value.revision) ||
			![
				'running',
				'success',
				'tool_error',
				'unknown',
			].includes(String(value.status))
		)
			return invalid();
	} else if (/\/spans\/[^/]+$/.test(route)) {
		if (
			!text(value.id) ||
			!('inputs' in value) ||
			!('outputs' in value)
		)
			return invalid();
	}
}
