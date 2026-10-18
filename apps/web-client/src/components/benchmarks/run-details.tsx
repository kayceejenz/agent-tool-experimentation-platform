'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StructuredPayload } from '@/components/content/structured-payload';
import { ReadableText } from '@/components/content/readable-text';
import { ExecutionTrace } from '@/components/agents/execution-trace';
import { ProjectSync } from '@/components/projects/project-provider';
import { projectRequest } from '@/lib/projects/client';
import type { Benchmark } from '@/types/benchmark';
import type { Project } from '@/types/workspace';

const percent = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)}%`);

export function resultLabel(item: Benchmark) {
	if (!item.execution_id) return 'Not tested yet';
	if (item.status === 'queued') return 'Waiting to start';
	if (item.status === 'running') return 'Agent is working…';
	if (!item.score?.matched_count)
		return item.calls.length
			? 'Expected tool not used'
			: 'No tool was called';
	if (!item.score.arguments_correct)
		return 'Right tool, different inputs';
	if (item.score.actual_count > 1)
		return 'Matching call, with extra calls';
	return 'Tool and inputs match';
}
export const pending = (item: Benchmark) =>
	item.status === 'queued' || item.status === 'running';

export function BenchmarkRunPage({
	project,
	executionId,
}: {
	project: Project;
	executionId: string;
}) {
	const [item, setItem] = useState<Benchmark | null>(null);
	const [error, setError] = useState('');
	const [refresh, setRefresh] = useState(0);
	const base = `/${project.id}`;
	useEffect(() => {
		const controller = new AbortController();
		void projectRequest<Benchmark>(
			`${base}/benchmarks/runs/${executionId}`,
			{ signal: controller.signal },
		)
			.then(value => {
				setItem(value);
				setError('');
			})
			.catch(e => {
				if (!controller.signal.aborted)
					setError(e.message);
			});
		return () => controller.abort();
	}, [base, executionId, refresh]);
	useEffect(() => {
		if (!item || !pending(item)) return;
		const timer = setTimeout(() => setRefresh(n => n + 1), 3000);
		return () => clearTimeout(timer);
	}, [item]);
	return (
		<>
			<ProjectSync project={project} />
			<header className='workspace-header'>
				<div>
					<Link
						href={`/projects/${project.id}/benchmarks`}>
						← Back to benchmarks
					</Link>
					<h1>Benchmark run</h1>
				</div>
			</header>
			{error && (
				<p role='alert' className='project-error'>
					{error}{' '}
					<button
						className='button'
						onClick={() =>
							setRefresh(n => n + 1)
						}>
						Retry
					</button>
				</p>
			)}
			{!item && !error && <p role='status'>Loading run…</p>}
			{item && (
				<BenchmarkRunDetails item={item} base={base} />
			)}
		</>
	);
}

function BenchmarkRunDetails({
	item,
	base,
}: {
	item: Benchmark;
	base: string;
}) {
	const [showTrace, setShowTrace] = useState(true);
	return (
		<section
			id='benchmark-run-details'
			className='panel simple-benchmark-panel'
			aria-labelledby='benchmark-run-heading'>
			<div className='prompt-toolbar'>
				<h2 id='benchmark-run-heading'>Run result</h2>
				<span className='badge'>
					{item.agent_name} · v
					{item.agent_revision}
				</span>
			</div>
			<p>
				<strong>{item.input}</strong>
			</p>
			<p>{resultLabel(item)}</p>
			{item.score && (
				<dl
					className='benchmark-metrics'
					aria-label='Selected run metrics'>
					<div>
						<dt>Tool precision</dt>
						<dd>
							{percent(
								item.score
									.actual_count
									? (100 *
											item
												.score
												.matched_count) /
											item
												.score
												.actual_count
									: null,
							)}
						</dd>
					</div>
					<div>
						<dt>Tool recall</dt>
						<dd>
							{percent(
								100 *
									item
										.score
										.matched_count,
							)}
						</dd>
					</div>
					<div>
						<dt>Argument accuracy</dt>
						<dd>
							{percent(
								item.score
									.matched_count
									? item
											.score
											.arguments_correct
										? 100
										: 0
									: null,
							)}
						</dd>
					</div>
				</dl>
			)}
			{item.status !== 'completed' && !pending(item) && (
				<p>
					Run {item.status}. Recorded calls may be
					incomplete.
				</p>
			)}
			{item.final_answer && (
				<div className='benchmark-final-answer'>
					<h3>Agent response</h3>
					<ReadableText
						text={item.final_answer}
					/>
				</div>
			)}
			<div className='benchmark-call-comparison'>
				<div>
					<h3>Expected call</h3>
					<p>
						{item.server_name} /{' '}
						{item.tool_name}
					</p>
					<StructuredPayload
						value={item.arguments}
						label='Expected inputs'
					/>
				</div>
				<div>
					<h3>Agent’s calls</h3>
					{!item.calls.length ? (
						<p>
							{pending(item)
								? 'Waiting for tool calls…'
								: 'The agent made no tool calls.'}
						</p>
					) : (
						item.calls.map((call, i) => (
							<div key={i}>
								<p>
									{i + 1}.{' '}
									{
										call.name
									}{' '}
									·{' '}
									{
										call.status
									}
								</p>
								<StructuredPayload
									value={
										call.inputs
									}
									label={`Call ${i + 1} inputs`}
								/>
							</div>
						))
					)}
				</div>
			</div>
			<button
				className='button'
				aria-expanded={showTrace}
				onClick={() => setShowTrace(value => !value)}>
				{showTrace
					? 'Hide execution steps'
					: 'Show execution steps'}
			</button>
			{showTrace && (
				<ExecutionTrace
					formatted
					path={`${base}/executions/${item.execution_id}`}
					version={item.status ?? ''}
				/>
			)}
		</section>
	);
}
