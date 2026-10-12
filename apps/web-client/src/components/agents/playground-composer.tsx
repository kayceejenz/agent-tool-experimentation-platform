'use client';
import Link from 'next/link';
import type { useAgentPlayground } from './use-agent-playground';
import { ArrowUp } from 'lucide-react';
import type { AgentSummary } from '@/types/agent';

type Props = Pick<
	ReturnType<typeof useAgentPlayground>,
	'updateInput' | 'input' | 'busy' | 'taskInput' | 'start'
> & { canRun: boolean; agent: AgentSummary; projectId: string };

export function PlaygroundComposer({
	updateInput,
	input,
	busy,
	taskInput,
	start,
	canRun,
	agent,
 projectId,
}: Props) {
	return (
		<section className='playground-composer' aria-label='Run agent'>
			<div className='playground-intro'>
				<h3>What would you like to try?</h3>
			</div>
			<form
				onSubmit={e => {
					e.preventDefault();
					void start();
				}}>
				<label
					htmlFor='playground-task'
					className='playground-task-label'>
					Your task
				</label>
				<div className='playground-input-box'>
					<textarea
						id='playground-task'
						aria-label='Task'
						ref={taskInput}
						value={input}
						rows={5}
						placeholder='Describe the outcome you need and any constraints…'
						maxLength={16000}
						disabled={busy || !canRun}
						onChange={event =>
							updateInput(
								event.target
									.value,
							)
						}
						onKeyDown={e => {
							if (
								e.key ===
									'Enter' &&
								(e.metaKey ||
									e.ctrlKey) &&
								!e.nativeEvent
									.isComposing
							) {
								e.preventDefault();
								if (
									!busy &&
									canRun &&
									agent.enabled &&
									input.trim()
								)
									e.currentTarget.form?.requestSubmit();
							}
						}}
					/>
					<div className='execution-actions'>
						<span>
							Ctrl / ⌘ + Enter to run
						</span>
						<button
							className='button primary'
							disabled={
								busy ||
								!canRun ||
								!agent.enabled ||
								!input.trim()
							}>
							{busy
								? 'Starting…'
								: 'Run task'}
							<ArrowUp
								size={16}
								aria-hidden='true'
							/>
						</button>
					</div>
				</div>
				{!canRun && (
					<p className='mcp-note'>
						You have read-only access. Open
						History to inspect saved tasks.
					</p>
				)}
				{canRun && !agent.enabled && (
					<p className='mcp-note'>
						Enable this agent in its configuration to run a task. <Link href={`/projects/${projectId}/agents/${agent.id}`}>Open configuration</Link>
					</p>
				)}
			</form>
		</section>
	);
}
