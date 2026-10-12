'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AgentEditor } from './agent-editor';
import { AgentPlayground } from './agent-playground';
import { ProjectSync } from '@/components/projects/project-provider';
import { projectRequest } from '@/lib/projects/client';
import type { Project } from '@/types/workspace';
import type { Agent, AgentSummary } from '@/types/agent';

export function AgentWorkspace({
	project,
	agentId,
	playground = false,
}: {
	project: Project;
	agentId: string;
	playground?: boolean;
}) {
	const router = useRouter();
	const [agent, setAgent] = useState<AgentSummary | null>(null);
	const [error, setError] = useState('');
	const [retry, setRetry] = useState(0);
	const isNew = agentId === 'new';
	const base = `/projects/${project.id}/agents`;

	useEffect(() => {
		if (isNew) return;

		const controller = new AbortController();

		let active = true;


		void projectRequest<Agent>(`/${project.id}/agents/${agentId}`, {
			signal: controller.signal,
		})
			.then(value => {
				if (active)
					setAgent({
						...value,
						tool_count: value.tools.length,
					});
			})
			.catch(reason => {
				if (active) setError(reason.message);
			});

		return () => {
			active = false;
			controller.abort();
		};
	}, [project.id, agentId, isNew, retry]);

	function saved(value: Agent) {
		setAgent({ ...value, tool_count: value.tools.length });
		if (isNew) router.replace(`${base}/${value.id}`);
	}

	return (
		<>
			<ProjectSync project={project} />
			<nav
				className='workspace-breadcrumb'
				aria-label='Breadcrumb'>
				<Link href={`/projects/${project.id}`}>
					{project.name}
				</Link>
				<span aria-hidden='true'>/</span>
				<Link href={base}>Agents</Link>
				<span aria-hidden='true'>/</span>
				<span aria-current='page'>
					{playground
						? 'Playground'
						: isNew
							? 'Create agent'
							: 'Configuration'}
				</span>
			</nav>
   <header className='workspace-header'><div><h1>{playground ? 'Playground' : isNew ? 'Create an agent' : 'Agent configuration'}</h1><p>{playground ? 'Run a task, review the answer, and inspect the evidence when needed.' : 'Choose instructions, a model, and tools. Advanced settings are optional.'}</p></div></header>

			{!isNew && agent && (
				<nav
					className='workspace-tabs'
					aria-label='Agent pages'>
					<Link
						href={`${base}/${agentId}`}
						aria-current={
							!playground
								? 'page'
								: undefined
						}>
						Configuration
					</Link>
					<Link
						href={`${base}/${agentId}/playground`}
						aria-current={
							playground
								? 'page'
								: undefined
						}>
						Playground
					</Link>
				</nav>
			)}
			{error ? (
				<div
					className='panel mcp-feedback'
					role='alert'>
					<p>{error}</p>
					<button
						className='button'
						onClick={() =>
							setRetry(n => n + 1)
						}>
						Try again
					</button>
				</div>
			) : !isNew && !agent ? (
				<p role='status'>Loading agent…</p>
			) : playground && agent ? (
				<AgentPlayground
					pageMode
					projectId={project.id}
					agent={agent}
					canRun={project.role !== 'viewer'}
					onClose={() => router.push(base)}
				/>
			) : (
				<AgentEditor
					pageMode
					projectId={project.id}
					initial={agent}
					canEdit={project.role !== 'viewer'}
					onSaved={saved}
					onClose={() => router.push(base)}
				/>
			)}
		</>
	);
}
