'use client';
import { useEffect, useState } from 'react';
import { ProjectUsage } from './project-usage';
import Link from 'next/link';
import { projectRequest } from '@/lib/projects/client';
import type { AgentPage } from '@/types/agent';
import type { ExecutionSummary } from '@/types/execution';
import type { Project } from '@/types/workspace';

export function ProjectDashboard({ project }: { project: Project }) {
	const [agents, setAgents] = useState<AgentPage | null>(null);
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
		void projectRequest<AgentPage>(`/${project.id}/agents`, options)
			.then(async agents => {
				if (!active) return;
				setAgents(agents);
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
	if (!agents) return <p role='status'>Loading project overview…</p>;
	return (
		<>
			<ProjectUsage projectId={project.id} />
			<details className='project-activity'>
				<summary>Project activity</summary>
				<section
					className='panel dashboard-section'
					aria-labelledby='recent-runs'>
					<h2 id='recent-runs'>Recent runs</h2>
					<p className='mcp-meta'>
						Latest activity from the first
						three agents in your list.
					</p>
					{runsError ? (
						<p role='status'>{runsError}</p>
					) : runs.length ? (
						<ul className='dashboard-list'>
							{runs.map(run => (
								<li
									key={
										run.id
									}>
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
							No runs yet. Try a task
							in an agent’s
							playground.
						</p>
					)}
				</section>
			</details>
		</>
	);
}
