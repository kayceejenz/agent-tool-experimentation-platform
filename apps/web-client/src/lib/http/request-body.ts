/** UTF-8 byte limits for the complete incoming body, including JSON syntax. */
export const BODY_LIMITS = {
	auth: 16_384,
	project: 16_384,
	mcp: 32_768,
	tool: 70_000,
	configuration: 220_000,
	execution: 70_000,
	control: 1_024,
} as const;

export class RequestBodyError extends Error {
	constructor(
		public status: 400 | 413,
		message: string,
	) {
		super(message);
	}
}

/** Read at most limit bytes. Content-Length is only an early rejection hint. */
export async function readBoundedBody(
	request: Request,
	limit: number,
): Promise<string> {
	const rejectLarge = () =>
		new RequestBodyError(413, 'Request body is too large.');
	const declaredLength = request.headers.get('content-length');
	if (
		declaredLength &&
		/^\d+$/.test(declaredLength) &&
		BigInt(declaredLength) > BigInt(limit)
	) {
		// Do not wait for an untrusted stream's cancellation to settle.
		if (request.body) void request.body.cancel().catch(() => {});
		throw rejectLarge();
	}
	if (!request.body) return '';

	const reader = request.body.getReader();
	// A single bounded buffer avoids retaining arbitrarily many small chunks.
	const bytes = new Uint8Array(limit);
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value.byteLength > limit - size)
				throw rejectLarge();
			bytes.set(value, size);
			size += value.byteLength;
		}
		return new TextDecoder('utf-8', { fatal: true }).decode(
			bytes.subarray(0, size),
		);
	} catch (error) {
		void reader.cancel().catch(() => {});
		if (error instanceof RequestBodyError) throw error;
		throw new RequestBodyError(400, 'Invalid request body.');
	} finally {
		reader.releaseLock();
	}
}

export async function readBoundedJson(
	request: Request,
	limit: number,
): Promise<unknown> {
	const text = await readBoundedBody(request, limit);
	try {
		return JSON.parse(text);
	} catch {
		throw new RequestBodyError(400, 'Invalid JSON.');
	}
}
