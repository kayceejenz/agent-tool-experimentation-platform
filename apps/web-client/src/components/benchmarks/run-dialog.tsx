'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { projectRequest, projectWrite } from '@/lib/projects/client';
import type { AgentPage, AgentSummary } from '@/types/agent';
import type { Benchmark } from '@/types/benchmark';

export function RunBenchmarkDialog({
	projectId,
	item,
	onClose,
	onStarted,
}: {
	projectId: string;
	item: Benchmark;
	onClose: () => void;
	onStarted: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [agents, setAgents] = useState<AgentSummary[]>([]);
	const [agentId, setAgentId] = useState('');
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const requestIds = useRef(new Map<string, string>());
	useEffect(() => {
		const node = dialog.current!;
		node.showModal();
		return () => node.close();
	}, []);
	useEffect(() => {
		const controller = new AbortController();
		async function load() {
			const items: AgentSummary[] = [];
			let offset: number | null = 0;
			while (offset !== null) {
				const page: AgentPage = await projectRequest(
					`/${projectId}/agents?offset=${offset}`,
					{ signal: controller.signal },
				);
				items.push(...page.items);
				offset = page.next_offset;
			}
			setAgents(items);
		}
		void load()
			.catch(e => {
				if (!controller.signal.aborted)
					setError(e.message);
			})
			.finally(() => {
				if (!controller.signal.aborted)
					setLoading(false);
			});
		return () => controller.abort();
	}, [projectId]);
	function close() {
		dialog.current?.close();
		onClose();
	}
	async function submit(event: FormEvent) {
		event.preventDefault();
		const agent = agents.find(a => a.id === agentId && a.enabled);
		if (!agent || busy) return;
		const key = `${agent.id}:${agent.revision}`;
		if (!requestIds.current.has(key))
			requestIds.current.set(key, crypto.randomUUID());
		setBusy(true);
		setError('');
		try {
			await projectWrite(
				`/${projectId}/agents/${agent.id}/executions`,
				'POST',
				{
					request_id: requestIds.current.get(key),
					revision: agent.revision,
					input: item.input,
					benchmark_id: item.id,
				},
			);
			onStarted();
			close();
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to start the run.',
			);
		} finally {
			setBusy(false);
		}
	}
	return (
		<dialog
			ref={dialog}
			className='benchmark-run-dialog'
			aria-labelledby='benchmark-dialog-title'
			onCancel={event => {
				event.preventDefault();
				if (!busy) close();
			}}>
			<h2 id='benchmark-dialog-title'>Run benchmark</h2>
			<p>{item.input}</p>
			<form onSubmit={submit}>
				<label className='benchmark-agent'>
					Agent to test
					<select
						autoFocus
						value={agentId}
						onChange={e =>
							setAgentId(
								e.target.value,
							)
						}
						disabled={busy || loading}
						required>
						<option value=''>
							{loading
								? 'Loading agents…'
								: 'Choose an agent'}
						</option>
						{agents.map(a => (
							<option
								key={a.id}
								value={a.id}
								disabled={
									!a.enabled
								}>
								{a.name} ·{' '}
								{
									a
										.model_settings
										.model
								}{' '}
								· v{a.revision}
								{!a.enabled
									? ' (disabled)'
									: ''}
							</option>
						))}
					</select>
				</label>
				{!loading && !agents.some(a => a.enabled) && (
					<p>
						<Link
							href={`/projects/${projectId}/agents`}>
							Enable an agent
						</Link>{' '}
						before running a benchmark.
					</p>
				)}
				<p className='tool-description'>
					Uses the agent’s normal tools and model.
					Model costs apply. No LLM judge is used.
				</p>
				{error && (
					<p
						role='alert'
						className='project-error'>
						{error}
					</p>
				)}
				<div className='benchmark-toolbar-actions'>
					<button
						type='button'
						className='button'
						onClick={close}
						disabled={busy}>
						Cancel
					</button>
					<button
						className='button primary'
						disabled={
							!agentId ||
							loading ||
							busy
						}>
						{busy
							? 'Starting…'
							: 'Start run'}
					</button>
				</div>
			</form>
		</dialog>
	);
}
