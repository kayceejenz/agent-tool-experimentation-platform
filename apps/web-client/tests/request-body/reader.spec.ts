import { test, expect } from '@playwright/test';
import { readBoundedBody, readBoundedJson } from '../../src/lib/http/request-body';

function streamed(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
	return new Request('http://localhost/api', {
		method: 'POST', body, headers, duplex: 'half',
	} as RequestInit);
}
const encoder = new TextEncoder();

test('accepts exact byte boundary and multibyte UTF-8 split across chunks', async () => {
	const payload = encoder.encode('"😀"');
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(payload.subarray(0, 3));
			controller.enqueue(payload.subarray(3));
			controller.close();
		},
	});
	await expect(readBoundedJson(streamed(body), payload.length)).resolves.toBe('😀');
});

test('counts bytes instead of characters', async () => {
	const request = new Request('http://localhost', { method: 'POST', body: '"😀"' });
	await expect(readBoundedJson(request, 5)).rejects.toMatchObject({ status: 413 });
});

const headerCases: Record<string, string>[] = [{}, { 'content-length': '1' }];
for (const headers of headerCases) {
	test(`cancels oversized stream early despite ${JSON.stringify(headers)}`, async () => {
		let pulls = 0;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulls++;
				controller.enqueue(encoder.encode('12345'));
			},
			cancel() { cancelled = true; },
		}, { highWaterMark: 0 });
		await expect(readBoundedBody(streamed(body, headers), 8)).rejects.toMatchObject({ status: 413 });
		expect(pulls).toBe(2);
		expect(cancelled).toBe(true);
	});
}

test('rejects oversized Content-Length without reading the body', async () => {
	let pulls = 0;
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		pull() { pulls++; },
		cancel() { cancelled = true; },
	}, { highWaterMark: 0 });
	await expect(readBoundedBody(streamed(body, { 'content-length': '100000000000000000000' }), 8))
		.rejects.toMatchObject({ status: 413 });
	expect(pulls).toBe(0);
	expect(cancelled).toBe(true);
});

test('handles many small chunks without needing a declared length', async () => {
	let index = 0;
	const payload = encoder.encode('{"ok":true}');
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (index === payload.length) controller.close();
			else controller.enqueue(payload.subarray(index, ++index));
		},
	});
	await expect(readBoundedJson(streamed(body), payload.length)).resolves.toEqual({ ok: true });
});

test('rejects invalid JSON and invalid UTF-8 as 400', async () => {
	await expect(readBoundedJson(new Request('http://localhost', { method: 'POST', body: '{' }), 8))
		.rejects.toMatchObject({ status: 400 });
	const body = new ReadableStream<Uint8Array>({
		start(controller) { controller.enqueue(new Uint8Array([0xff])); controller.close(); },
	});
	await expect(readBoundedJson(streamed(body), 8)).rejects.toMatchObject({ status: 400 });
});

test('permits absent control bodies but rejects absent JSON', async () => {
	await expect(readBoundedBody(new Request('http://localhost', { method: 'POST' }), 8)).resolves.toBe('');
	await expect(readBoundedJson(new Request('http://localhost', { method: 'POST' }), 8))
		.rejects.toMatchObject({ status: 400 });
});
