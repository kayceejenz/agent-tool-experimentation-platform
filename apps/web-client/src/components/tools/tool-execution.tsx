'use client';
import type { ToolExecution } from '@/types/tool';

export function Execution({ execution }: { execution: ToolExecution }) {
	const envelope =
		execution.result && typeof execution.result === 'object'
			? (execution.result as Record<string, unknown>)
			: null;
	const output =
		envelope?.structuredContent ??
		envelope?.content ??
		execution.result;
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
			<pre className='tool-output'>
				{JSON.stringify(output, null, 2)}
			</pre>
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
