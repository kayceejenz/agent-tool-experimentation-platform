'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { StructuredPayload } from '@/components/content/structured-payload';
import type { ToolExecution } from '@/types/tool';

export function Execution({ execution }: { execution: ToolExecution }) {
	const projectId = usePathname().split('/')[2];
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
				<StructuredPayload
					value={execution.inputs}
					label='Saved inputs'
				/>
			</details>
			<div className='tool-output-readable'>
				<h4>Result</h4>
				{execution.status === 'success' &&
					projectId && (
						<Link
							className='button'
							href={`/projects/${projectId}/benchmarks?capture=${execution.id}`}>
							Save as benchmark
						</Link>
					)}
				<StructuredPayload
					value={execution.result}
					label='Tool response'
					response
				/>
			</div>
		</div>
	);
}
