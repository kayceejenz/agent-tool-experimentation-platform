'use client';
import { History, Plus, X } from 'lucide-react';
import styles from './agent-playground.module.css';
import type { AgentSummary } from '@/types/agent';
import { useAgentPlayground } from '@/components/agents/use-agent-playground';
import { PlaygroundHistory } from './playground-history';
import { PlaygroundComposer } from './playground-composer';
import { PlaygroundResults } from './playground-results';

export function AgentPlayground({
	projectId,
	agent,
	canRun,
	onClose,
}: {
	projectId: string;
	agent: AgentSummary;
	canRun: boolean;
	onClose: () => void;
}) {
	const {
		updateInput, editTask, refreshHistory,
		dialog,
		input,
		error,
		busy,
		run,
		history,
		offset,
		view,
		setView,
		showDetails,
		setShowDetails,
		expandedTask,
		setExpandedTask,
		copied,
		taskInput,
		base,
		pending,
		polling,
		inspect,
		start,
		cancel,
		more,
		failureHint,
		copyAnswer,
		newTask,
	} = useAgentPlayground({ projectId, agent });
	return (
		<dialog
			ref={dialog}
			className={styles.root}
			aria-labelledby='playground-title'
			onCancel={e => {
				e.preventDefault();
				onClose();
			}}>
			<header className='playground-header'>
				<div className='playground-heading'>
					<p className='eyebrow'>Playground</p>
					<h2 id='playground-title'>
						{agent.name}
					</h2>
					<p className='playground-subtitle'>
						{agent.model_settings.model ||
							'Model not configured'}
					</p>
				</div>
				<div className='playground-header-actions'>
					<button
						className='button playground-secondary'
						disabled={busy}
						aria-pressed={view === 'history'}
						onClick={() =>
							setView(
								view ===
									'history'
									? 'run'
									: 'history',
							)
						}>
						<History
							size={16}
							aria-hidden='true'
						/>
						History
					</button>
					{run && (
						<button
							className='button playground-secondary'
							disabled={busy || pending}
							onClick={newTask}>
							<Plus
								size={16}
								aria-hidden='true'
							/>
							New task
						</button>
					)}
				</div>
				<button
					className='playground-close'
					aria-label='Close'
					onClick={onClose}>
					<X size={20} aria-hidden='true' />
				</button>
			</header>
			<div className='playground-body'>
				{(error || polling.error) && (
					<p
						role='alert'
						className='playground-feedback mcp-error'>
						{error || polling.error}
					</p>
				)}
				{polling.stopped && <button type='button' className='button' onClick={polling.reconnect}>Reconnect execution</button>}
				{view === 'history' ? (
					<PlaygroundHistory
						busy={busy}
						run={run}
						history={history}
						offset={offset}
						setView={setView}
						inspect={inspect}
						more={more}
						refreshHistory={refreshHistory}
					/>
				) : !run ? (
					<PlaygroundComposer
						input={input}
						busy={busy}
						taskInput={taskInput}
						start={start}
						canRun={canRun}
						agent={agent}
						updateInput={updateInput}
					/>
				) : (
					<PlaygroundResults
						busy={busy}
						run={run}
						showDetails={showDetails}
						setShowDetails={setShowDetails}
						expandedTask={expandedTask}
						setExpandedTask={setExpandedTask}
						copied={copied}
						base={base}
						pending={pending}
						cancel={cancel}
						failureHint={failureHint}
						copyAnswer={copyAnswer}
						canRun={canRun}
						editTask={editTask}
					/>
				)}
			</div>
		</dialog>
	);
}
