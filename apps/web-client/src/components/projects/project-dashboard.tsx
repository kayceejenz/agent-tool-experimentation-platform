'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { projectRequest } from '@/lib/projects/client';
import type { AgentPage } from '@/types/agent';
import type { McpServerPage } from '@/types/mcp-server';
import type { ToolPage } from '@/types/tool';
import type { ExecutionSummary } from '@/types/execution';
import type { Project } from '@/types/workspace';

export function ProjectDashboard({ project }: { project: Project }) {
	const [data, setData] = useState<{
		servers: McpServerPage;
		tools: ToolPage;
		agents: AgentPage;
	} | null>(null);
	const [runs, setRuns] = useState<
		(ExecutionSummary & { agentId: string; agentName: string })[]
	>([]);
	const [error, setError] = useState('');
	const [runsError, setRunsError] = useState('');
	const [retry, setRetry] = useState(0);
	const base = `/projects/${project.id}`;
	useEffect(() => {
		const controller = new AbortController();
		let active = true;
		const options = { signal: controller.signal };
		void Promise.all([
			projectRequest<McpServerPage>(
				`/${project.id}/mcp-servers`,
				options,
			),
			projectRequest<ToolPage>(
				`/${project.id}/tools`,
				options,
			),
			projectRequest<AgentPage>(
				`/${project.id}/agents`,
				options,
			),
		])
			.then(async ([servers, tools, agents]) => {
				if (!active) return;
				setData({ servers, tools, agents });
				try {
					const histories = await Promise.all(
						agents.items
							.slice(0, 3)
							.map(async agent => {
								const page =
									await projectRequest<{
										items: ExecutionSummary[];
									}>(
										`/${project.id}/agents/${agent.id}/executions`,
										options,
									);
								return page.items.map(
									run => ({
										...run,
										agentId: agent.id,
										agentName: agent.name,
									}),
								);
							}),
					);
					if (active)
						setRuns(
							histories
								.flat()
								.sort((a, b) =>
									b.created_at.localeCompare(
										a.created_at,
									),
								)
								.slice(0, 5),
						);
				} catch {
					if (active)
						setRunsError(
							'Recent runs could not be loaded. Open an agent’s playground to inspect its history.',
						);
				}
			})
			.catch(reason => {
				if (active) setError(reason.message);
			});
		return () => {
			active = false;
			controller.abort();
		};
	}, [project.id, retry]);
	if (error)
		return (
			<section
				className='panel dashboard-section'
				role='alert'>
				<p>{error}</p>
				<button
					className='button'
					onClick={() => {
						setError('');
						setRunsError('');
						setRetry(n => n + 1);
					}}>
					Try again
				</button>
			</section>
		);
	if (!data) return <p role='status'>Loading project overview…</p>;
	const runnable = data.agents.items.find(agent => agent.enabled);
	const steps = [
		{
			title: 'Connect a server',
			description:
				'Add a connection and check that it is reachable.',
			done: data.servers.items.some(
				server =>
					server.connection_status ===
					'connected',
			),
			href: `${base}/servers`,
		},
		{
			title: 'Discover and enable tools',
			description:
				'Inspect the available tools and enable the ones you need.',
			done: data.tools.items.some(
				tool =>
					tool.enabled &&
					tool.available &&
					tool.server_enabled,
			),
			href: `${base}/tools`,
		},
		{
			title: 'Configure an agent',
			description: 'Choose instructions, a model, and tools.',
			done: data.agents.items.length > 0,
			href: `${base}/agents`,
		},
		{
			title: 'Run your first task',
			description:
				'Enable your agent, then inspect its answer and evaluation.',
			done: runs.length > 0,
			href: runnable
				? `${base}/agents/${runnable.id}/playground`
				: `${base}/agents`,
		},
	];
	const next = steps.find(step => !step.done);
	return (
		<>
			<section
				className='panel dashboard-section'
				aria-labelledby='project-next-step'>
				<div className='dashboard-heading'>
					<div>
						<h2 id='project-next-step'>
							{next
								? 'Your next step'
								: 'Your project is ready'}
						</h2>
						<p>
							{next?.description ??
								'Run a task and review how your agent used its tools.'}
						</p>
					</div>
					<Link
						className='button primary'
						href={
							next?.href ??
							(runnable
								? `${base}/agents/${runnable.id}/playground`
								: `${base}/agents`)
						}>
						{next?.title ?? 'Run agent'}
					</Link>
				</div>
				<ol className='setup-checklist'>
					{steps.map((step, index) => (
						<li key={step.title}>
							<span
								className={
									step.done
										? 'setup-marker done'
										: 'setup-marker'
								}
								aria-hidden='true'>
								{step.done
									? '✓'
									: index +
										1}
							</span>
							<div>
								<Link
									href={
										step.href
									}>
									{
										step.title
									}
								</Link>
								<small>
									{step.done
										? 'Complete'
										: step.description}
								</small>
							</div>
						</li>
					))}
				</ol>
			</section>
			<section
				className='metric-grid dashboard-metrics'
				aria-label='Project resources'>
				{[
					[
						'Connections',
						data.servers.items.length,
						data.servers.next_cursor,
						'servers',
					],
					[
						'Tools',
						data.tools.items.length,
						data.tools.next_offset !== null,
						'tools',
					],
					[
						'Agents',
						data.agents.items.length,
						data.agents.next_offset !==
							null,
						'agents',
					],
				].map(([label, count, more, path]) => (
					<Link
						className='metric-card'
						href={`${base}/${path}`}
						key={String(label)}>
						<span>{label}</span>
						<strong>
							{count}
							{more ? '+' : ''}
						</strong>
						<small>
							View{' '}
							{String(
								label,
							).toLowerCase()}
						</small>
					</Link>
				))}
			</section>
			<section
				className='panel dashboard-section'
				aria-labelledby='connection-health'>
				<h2 id='connection-health'>
					Connection health
				</h2>
				{data.servers.items.length ? (
					<ul className='dashboard-list'>
						{data.servers.items.map(
							server => (
								<li
									key={
										server.id
									}>
									<Link
										href={`${base}/servers`}>
										{
											server.name
										}
									</Link>
									<span
										className={`execution-status status-${server.connection_status === 'connected' ? 'completed' : server.connection_status === 'error' ? 'failed' : 'queued'}`}>
										{server.connection_status ===
										'connected'
											? 'Connected'
											: server.connection_status ===
												  'error'
												? 'Needs attention'
												: 'Not checked'}
									</span>
								</li>
							),
						)}
					</ul>
				) : (
					<p>
						No connections yet. Start by
						adding an MCP server.
					</p>
				)}
			</section>
			<section
				className='panel dashboard-section'
				aria-labelledby='recent-runs'>
				<h2 id='recent-runs'>Recent runs</h2>
				<p className='mcp-meta'>
					Latest activity from the first three
					agents in your list.
				</p>
				{runsError ? (
					<p role='status'>{runsError}</p>
				) : runs.length ? (
					<ul className='dashboard-list'>
						{runs.map(run => (
							<li key={run.id}>
								<div>
									<Link
										href={`${base}/agents/${run.agentId}/playground?execution=${run.id}`}>
										{run.input.slice(
											0,
											120,
										)}
									</Link>
									<small>
										{
											run.agentName
										}{' '}
										·{' '}
										<time
											dateTime={
												run.created_at
											}>
											{new Date(
												run.created_at,
											).toLocaleString()}
										</time>
									</small>
								</div>
								<span
									className={`execution-status status-${run.status}`}>
									{run.status ===
									'completed'
										? 'Finished'
										: run.status.replaceAll(
												'_',
												' ',
											)}
								</span>
							</li>
						))}
					</ul>
				) : (
					<p>
						No runs yet. Try a task in an
						agent’s playground.
					</p>
				)}
			</section>
		</>
	);
}
