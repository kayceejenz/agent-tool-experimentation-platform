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

	if (route.endsWith('/usage')) {
		const totals = (entry: unknown) =>
			isRecord(entry) &&
			[
				'input_tokens',
				'output_tokens',
				'total_tokens',
				'calls',
				'missing_usage_calls',
				'unpriced_calls',
			].every(
				key =>
					Number.isSafeInteger(entry[key]) &&
					Number(entry[key]) >= 0,
			) &&
			(typeof entry.estimated_cost_usd === 'string' ||
				typeof entry.estimated_cost_usd === 'number') &&
			Number.isFinite(Number(entry.estimated_cost_usd)) &&
			Number(entry.estimated_cost_usd) >= 0;
		if (
			value.currency !== 'USD' ||
			!text(value.pricing_date) ||
			!totals(value.totals) ||
			!isRecord(value.sources) ||
			!totals(value.sources.agent) ||
			!totals(value.sources.evaluation) ||
			!Array.isArray(value.daily) ||
			value.daily.length !== 14 ||
			!value.daily.every(
				day =>
					totals(day) &&
					isRecord(day) &&
					typeof day.date === 'string' &&
					/^\d{4}-\d{2}-\d{2}$/.test(day.date),
			)
		)
			return invalid();
		return;
	}
	const catalog =
		/\/(tools|prompts|spans|evaluations)$/.test(route) &&
		method === 'GET';
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
		if (route.endsWith('/evaluations')) {
			if (!('next_offset' in value)) return invalid();
			const finding = (item: unknown) =>
				isRecord(item) &&
				text(item.name) &&
				text(item.reason) &&
				Array.isArray(item.evidence_refs) &&
				item.evidence_refs.every(
					ref => typeof ref === 'string',
				);
			for (const item of value.items) {
				if (
					!isRecord(item) ||
					!positive(item.attempt) ||
					![
						'queued',
						'running',
						'completed',
						'failed',
					].includes(String(item.status)) ||
					!isRecord(item.profile) ||
					!text(item.profile.model) ||
					!positive(item.profile.rubric_version)
				)
					return invalid();
				if (
					item.report !== null &&
					(!isRecord(item.report) ||
						!text(
							item.report
								.task_outcome,
						) ||
						!text(
							item.report
								.overall_verdict,
						) ||
						![
							'checks',
							'requirements',
							'critical_failures',
						].every(
							key =>
								Array.isArray(
									item.report &&
										(
											item.report as Record<
												string,
												unknown
											>
										)[
											key
										],
								) &&
								(
									(
										item.report as Record<
											string,
											unknown
										>
									)[
										key
									] as unknown[]
								).every(
									finding,
								),
						) ||
						!Array.isArray(
							item.report.limitations,
						) ||
						!item.report.limitations.every(
							text,
						))
				)
					return invalid();
				if (
					item.metrics !== null &&
					(!isRecord(item.metrics) ||
						!isRecord(
							item.metrics
								.usage_counts,
						) ||
						!Array.isArray(
							item.metrics.assertions,
						))
				)
					return invalid();
			}
		}
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
