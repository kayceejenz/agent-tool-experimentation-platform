'use client';
import type { useAgentPlayground } from './use-agent-playground';
import { ArrowLeft } from 'lucide-react';

type Props = Pick<ReturnType<typeof useAgentPlayground>, 'refreshHistory'
	| 'busy'
	| 'history'
	| 'offset'
	| 'setView'
	| 'inspect'
	| 'more'> & { run: ReturnType<typeof useAgentPlayground>['run'] };

export function PlaygroundHistory({ refreshHistory, busy, run, history, offset, setView, inspect, more }: Props) {
	return (<section
		className='playground-history'
		aria-label='Execution history'>
		<button
			className='playground-back'
			onClick={() => setView('run')}>
			<ArrowLeft
				size={16}
				aria-hidden='true'
			/>
			Back to playground
		</button>
		<div className='playground-section-heading'>
			<h3>Recent tasks</h3>
			<button
				className='button'
				disabled={busy}
				onClick={refreshHistory}>
				Refresh
			</button>
		</div>
		{!history.length && (
			<div className='playground-empty'>
				<h4>
					No tasks
					yet
				</h4>
				<p>
					Run your
					first
					task to
					see it
					here.
				</p>
			</div>
		)}
		<ul className='execution-history'>
			{history.map(item => (
				<li
					key={item.id}>
					<button
						disabled={busy}
						onClick={() => void inspect(item.id)}
						aria-pressed={
							run?.id ===
							item.id
						}>
						<span className='history-task'>
							{item.input}
						</span>
						<span
							className={`execution-status status-${item.status}`}>
							{item.status}
						</span>
						<small>
							{new Date(item.created_at).toLocaleString()}
						</small>
					</button>
				</li>
			))}
		</ul>
		{offset !== null && (
			<button
				className='button'
				disabled={busy}
				onClick={() => void more()}>
				Load more
			</button>
		)}
	</section>);
}
