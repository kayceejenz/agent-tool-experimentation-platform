'use client';
import type { useAgentPlayground } from './use-agent-playground';
import { Check, Copy } from 'lucide-react';
import { ExecutionTrace } from './execution-trace';

type Props = Pick<ReturnType<typeof useAgentPlayground>, 'editTask'
	| 'busy'
	| 'showDetails'
	| 'setShowDetails'
	| 'expandedTask'
	| 'setExpandedTask'
	| 'copied'
	| 'base'
	| 'pending'
	| 'cancel'
	| 'failureHint'
	| 'copyAnswer'> & { run: NonNullable<ReturnType<typeof useAgentPlayground>['run']>; canRun: boolean };

export function PlaygroundResults({
	editTask,
	busy,
	run,
	showDetails,
	setShowDetails,
	expandedTask,
	setExpandedTask,
	copied,
	base,
	pending,
	cancel,
	failureHint,
	copyAnswer,
	canRun,
}: Props) {
	return (<section
		className='playground-results'
		aria-label='Execution stack'
		key={run.id}>
		<div className='playground-task-message'>
			<span className='playground-message-label'>
				Your task
			</span>
			<p
				className={
					run
						.input
						.length >
						400 &&
						!expandedTask
						? 'playground-task-preview'
						: undefined
				}>
				{run.input}
			</p>
			{run.input.length >
				400 && (
					<button
						className='playground-text-button'
						aria-expanded={expandedTask}
						onClick={() => setExpandedTask(open => !open)}>
						{expandedTask
							? 'Show less'
							: 'Show full task'}
					</button>
				)}
			{!pending && canRun && (
				<button
					className='playground-text-button'
					disabled={busy}
					onClick={editTask}>
					Edit and
					run
					again
				</button>
			)}
		</div>
		<div className='playground-run-heading'>
			<h3>Answer</h3>
			<div className='playground-run-actions'>
				{run.final_answer && (
					<button
						className='playground-copy'
						aria-label={
							copied
								? 'Answer copied'
								: 'Copy answer'
						}
						onClick={() => void copyAnswer()}>
						{copied ? (
							<Check
								size={15}
								aria-hidden='true'
							/>
						) : (
							<Copy
								size={15}
								aria-hidden='true'
							/>
						)}
						<span>
							{copied
								? 'Copied'
								: 'Copy'}
						</span>
					</button>
				)}
				<span
					role='status'
					className={`execution-status status-${run.status}`}>
					{run.status}
				</span>
				{pending &&
					canRun && (
						<button
							className='button'
							disabled={busy}
							onClick={() => void cancel()}>
							Stop
						</button>
					)}
			</div>
		</div>
		{run.final_answer ? (
			<div className='execution-answer'>
				<p>
					{run.final_answer}
				</p>
			</div>
		) : pending ? (
			<div className='playground-working'>
				<span
					className='playground-progress'
					aria-hidden='true'
				/>
				<div>
					<p>
						{run.status ===
							'queued'
							? 'Waiting to start…'
							: 'Working on your task…'}
					</p>
					<small>
						You
						can
						close
						this
						window.
						Your
						task
						will
						keep
						running.
					</small>
				</div>
			</div>
		) : (
			<div className='playground-outcome'>
				<h4>
					{run.status ===
						'failed'
						? 'The task could not finish'
						: run.status ===
							'cancelled'
							? 'Task stopped'
							: 'No answer returned'}
				</h4>
				<p>
					{failureHint ??
						'Open execution details below to see where the task stopped.'}
				</p>
				{run.termination_reason && (
					<span className='playground-reason'>
						{run.termination_reason.replaceAll('_', ' ')}
					</span>
				)}
			</div>
		)}
		<details
			className='playground-details'
			open={showDetails}
			onToggle={e =>
				setShowDetails(
					e
						.currentTarget
						.open,
				)
			}>
			<summary>
				Execution
				details{' '}
				<span>
					{(run.tool_calls ?? 0)}{' '}
					tool{' '}
					{(run.tool_calls ?? 0) ===
						1
						? 'call'
						: 'calls'}{' '}
					·{' '}
					{(run.model_turns ?? 0)}{' '}
					model{' '}
					{(run.model_turns ?? 0) ===
						1
						? 'turn'
						: 'turns'}
				</span>
			</summary>
			{showDetails && <ExecutionTrace
				key={run.id}
				path={`${base}/executions/${run.id}`}
				version={`${run.status}:${run.model_turns}:${run.tool_calls}`}
			/>}

		</details>
	</section>);
}
