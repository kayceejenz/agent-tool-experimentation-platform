'use client';
import { useEffect, useRef, useState } from 'react';
import { ProjectSync } from '@/components/projects/project-provider';
import { projectRequest } from '@/lib/projects/client';
import type { Project } from '@/types/workspace';
import type { AgentPage, AgentSummary } from '@/types/agent';
import { AgentEditor } from './agent-editor';
import { AgentPlayground } from './agent-playground';
export function Agents({ project }: { project: Project }) {
	const [selection, setSelection] = useState<AgentSummary | 'new' | null>(null),
		[generation, setGeneration] = useState(0);
	const opener = useRef<HTMLElement | null>(null);
	const [playground, setPlayground] = useState<AgentSummary | null>(null);
	return (
		<>
			<ProjectSync project={project} />
			<header className="workspace-header">
				<div>
					<h1>Agents</h1>
					<p>
						Configure versioned agents with prompts, models and selected tools.
					</p>
				</div>
				{project.role !== 'viewer' && (
					<button
						className="button primary"
						onClick={(e) => {
							opener.current = e.currentTarget;
							setSelection('new');
						}}
					>
						Create agent
					</button>
				)}
			</header>
			<section className="panel">
				<div className="prompt-toolbar">
					<p className="mcp-meta">
						Run configured agents and inspect their model turns and tool calls.
					</p>
					<button
						className="button"
						onClick={() => setGeneration((n) => n + 1)}
					>
						Refresh
					</button>
				</div>
				<AgentList
					key={generation}
					projectId={project.id}
					onPlayground={(agent, button) => { opener.current = button; setPlayground(agent); }}
					onSelect={(agent, button) => {
						opener.current = button;
						setSelection(agent);
					}}
				/>
			</section>
			{playground && <AgentPlayground projectId={project.id} agent={playground} canRun={project.role !== 'viewer'} onClose={() => { setPlayground(null); requestAnimationFrame(() => opener.current?.focus()); }} />}
			{selection && (
				<AgentEditor
					projectId={project.id}
					initial={selection === 'new' ? null : selection}
					canEdit={project.role !== 'viewer'}
					onSaved={() => setGeneration((n) => n + 1)}
					onClose={() => {
						setSelection(null);
						requestAnimationFrame(() =>
							opener.current?.isConnected
								? opener.current.focus()
								: document
										.querySelector<HTMLButtonElement>('.prompt-toolbar button')
										?.focus(),
						);
					}}
				/>
			)}
		</>
	);
}
function AgentList({
	projectId,
	onSelect,
	onPlayground,
}: {
	projectId: string;
	onSelect: (agent: AgentSummary, button: HTMLElement) => void;
	onPlayground: (agent: AgentSummary, button: HTMLElement) => void;
}) {
	const [items, setItems] = useState<AgentSummary[]>([]),
		[offset, setOffset] = useState<number | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState('');
	const active = useRef(true);
	const base = `/${projectId}/agents`;
	useEffect(() => {
		active.current = true;
		let valid = true;
		void projectRequest<AgentPage>(base)
			.then((page) => {
				if (valid) {
					setItems(page.items);
					setOffset(page.next_offset);
				}
			})
			.catch((e) => {
				if (valid) setError(e.message);
			})
			.finally(() => {
				if (valid) setLoading(false);
			});
		return () => {
			valid = false;
			active.current = false;
		};
	}, [base]);
	async function more() {
		if (offset === null) return;
		setLoading(true);
		try {
			const page = await projectRequest<AgentPage>(`${base}?offset=${offset}`);
			if (active.current) {
				setItems((old) => [...old, ...page.items]);
				setOffset(page.next_offset);
			}
		} catch (e) {
			if (active.current)
				setError(e instanceof Error ? e.message : 'Unable to load agents.');
		} finally {
			if (active.current) setLoading(false);
		}
	}
	return (
		<>
			{error && (
				<p className="mcp-feedback mcp-error" role="alert">
					{error}
				</p>
			)}
			{loading && !items.length ? (
				<p className="mcp-feedback" role="status">
					Loading agents…
				</p>
			) : !items.length && !error ? (
				<div className="empty-state">
					<h2>No agents yet</h2>
					<p>
						Create an agent and choose the instructions and tools it can use.
					</p>
				</div>
			) : (
				!!items.length && (
					<div className="tool-table-wrap">
						<table className="tool-table">
							<thead>
								<tr>
									<th>Name</th>
									<th>Model</th>
									<th>Revision</th>
									<th>Tools</th>
									<th>Availability</th>
									<th>Action</th>
								</tr>
							</thead>
							<tbody>
								{items.map((agent) => (
									<tr key={agent.id}>
										<td>
											<strong>{agent.name}</strong>
											<p className="tool-description">
												{agent.description || 'No description'}
											</p>
										</td>
										<td>
											{agent.model_settings.model || 'Not configured'}
											<small>{agent.model_settings.provider}</small>
										</td>
										<td>v{agent.revision}</td>
										<td>{agent.tool_count}</td>
										<td>{agent.enabled ? 'Enabled' : 'Disabled'}</td>
										<td>
											<button
												className="button"
												aria-label={`Manage ${agent.name}`}
												onClick={(e) => onSelect(agent, e.currentTarget)}
											>
												Manage
											</button>
											<button className="button" aria-label={`Playground ${agent.name}`} onClick={(e) => onPlayground(agent, e.currentTarget)}>Playground</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)
			)}
			{offset !== null && (
				<div className="mcp-feedback">
					<button
						className="button"
						disabled={loading}
						onClick={() => void more()}
					>
						Load more agents
					</button>
				</div>
			)}
		</>
	);
}
