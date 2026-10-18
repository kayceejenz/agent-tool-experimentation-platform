'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReadableOutput } from './readable-output';
import type { ToolExecution } from '@/types/tool';

export function Execution({ execution }: { execution: ToolExecution }) {
	const projectId = usePathname().split('/')[2];
	const envelope =
		execution.result && typeof execution.result === 'object'
			? (execution.result as Record<string, unknown>)
			: null;
	let output =
		envelope?.structuredContent ??
		envelope?.content ??
		execution.result;
	if (
		Array.isArray(output) &&
		output.every(
			block =>
				block &&
				typeof block === 'object' &&
				(block as Record<string, unknown>).type ===
					'text',
		)
	) {
		const text = output
			.map(block => (block as Record<string, unknown>).text)
			.join('\n');
		try {
			output = JSON.parse(text);
		} catch {
			output = text;
		}
	}
	return (
		<div>
			<p className='tool-result-meta'>
				{execution.status.replaceAll('_', ' ')}
				{execution.duration_ms !== null
					? ` · ${execution.duration_ms} ms`
					: ''}
				{execution.error_code
					? ` · ${execution.error_code}`
					: ''}
			</p>
			{execution.status === 'unknown' && (
				<p>
					The request may have completed remotely.
					Verify before repeating it.
				</p>
			)}
			<details>
				<summary>Saved inputs</summary>
				<pre>
					{JSON.stringify(
						execution.inputs,
						null,
						2,
					)}
				</pre>
			</details>
			<div className='tool-output-readable'>
				<h4>Result</h4>
                {execution.status === 'success' && projectId && <Link className='button' href={`/projects/${projectId}/benchmarks?capture=${execution.id}`}>Save as benchmark</Link>}
				<ReadableOutput value={output} />
			</div>
			<details>
				<summary>Raw response</summary>
				<pre>
					{JSON.stringify(
						execution.result,
						null,
						2,
					)}
				</pre>
			</details>
		</div>
	);
}
