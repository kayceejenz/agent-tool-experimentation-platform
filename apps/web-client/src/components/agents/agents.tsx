'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ProjectSync } from '@/components/projects/project-provider';
import { projectRequest } from '@/lib/projects/client';
import type { Project } from '@/types/workspace';
import type { AgentPage, AgentSummary } from '@/types/agent';

export function Agents({ project }: { project: Project }) {
	const router = useRouter();
	const [generation, setGeneration] = useState(0);
	const base = `/projects/${project.id}/agents`;

	return (
		<>
			<ProjectSync project={project} />
			<header className='workspace-header'>
				<div>
					<h1>Agents</h1>
					<p>
						Choose an agent to run a task or
						edit its configuration.
					</p>
				</div>
				{project.role !== 'viewer' && (
					<Link
						className='button primary'
						href={`${base}/new`}>
						Create agent
					</Link>
				)}
			</header>
			<section className='panel' aria-label='Agent list'>
				<div className='prompt-toolbar'>
					<p className='mcp-meta'>
						Configurations are versioned so
						every run can be traced.
					</p>
					<button
						className='button'
						onClick={() =>
							setGeneration(
								n => n + 1,
							)
						}>
						Refresh
					</button>
				</div>
				<AgentList
					key={generation}
					projectId={project.id}
                    canRemove={project.role !== 'viewer'}
					onSelect={agent =>
						router.push(
							`${base}/${agent.id}`,
						)
					}
					onPlayground={agent =>
						router.push(
							`${base}/${agent.id}/playground`,
						)
					}
				/>
			</section>
		</>
	);
}

function AgentList({
	projectId,
    canRemove,
	onSelect,
	onPlayground,
}: {
	projectId: string;
    canRemove: boolean;
	onSelect: (agent: AgentSummary, button: HTMLElement) => void;
	onPlayground: (agent: AgentSummary, button: HTMLElement) => void;
}) {
	const [items, setItems] = useState<AgentSummary[]>([]),
		[offset, setOffset] = useState<number | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState('');
    const [removeTarget, setRemoveTarget] = useState<AgentSummary | null>(null);
    const [removing, setRemoving] = useState(false);
    const [removeError, setRemoveError] = useState('');
    const removeDialog = useRef<HTMLDialogElement>(null);
    const removeButton = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
        if (removeTarget) removeDialog.current?.showModal();
        else removeDialog.current?.close();
    }, [removeTarget]);
    async function removeAgent() {
        if (!removeTarget || removing) return;
        setRemoving(true);
        try {
            await projectRequest(`/${projectId}/agents/${removeTarget.id}`, { method: 'DELETE' });
            setItems(items => items.filter(item => item.id !== removeTarget.id));
            setOffset(value => value === null ? null : Math.max(0, value - 1));
            setRemoveTarget(null);
        } catch (e) { setRemoveError(e instanceof Error ? e.message : 'Unable to remove agent.'); }
        finally { setRemoving(false); }
    }
	const active = useRef(true);
	const base = `/${projectId}/agents`;
	useEffect(() => {
		active.current = true;
		let valid = true;
		void projectRequest<AgentPage>(base)
			.then(page => {
				if (valid) {
					setItems(page.items);
					setOffset(page.next_offset);
				}
			})
			.catch(e => {
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
			const page = await projectRequest<AgentPage>(
				`${base}?offset=${offset}`,
			);
			if (active.current) {
				setItems(old => [...old, ...page.items]);
				setOffset(page.next_offset);
			}
		} catch (e) {
			if (active.current)
				setError(
					e instanceof Error
						? e.message
						: 'Unable to load agents.',
				);
		} finally {
			if (active.current) setLoading(false);
		}
	}
	return (
		<>
			{error && (
				<p
					className='mcp-feedback mcp-error'
					role='alert'>
					{error}
				</p>
			)}
			{loading && !items.length ? (
				<p className='mcp-feedback' role='status'>
					Loading agents…
				</p>
			) : !items.length && !error ? (
				<div className='empty-state'>
					<h2>No agents yet</h2>
					<p>
						Create an agent and choose the
						instructions and tools it can
						use.
					</p>
				</div>
			) : (
				!!items.length && (
					<div className='tool-table-wrap'>
						<table className='tool-table'>
							<thead>
								<tr>
									<th scope='col'>
										Name
									</th>
									<th scope='col'>
										Model
									</th>
									<th scope='col'>
										Revision
									</th>
									<th scope='col'>
										Tools
									</th>
									<th scope='col'>
										Availability
									</th>
									<th scope='col'>
										Action
									</th>
								</tr>
							</thead>
							<tbody>
								{items.map(
									agent => (
										<tr
											key={
												agent.id
											}>
											<td data-label="Name">
												<strong>
													{
														agent.name
													}
												</strong>
												<p className='tool-description'>
													{agent.description ||
														'No description'}
												</p>
											</td>
											<td data-label="Model">
												{agent
													.model_settings
													.model ||
													'Not configured'}
												<small>
													{
														agent
															.model_settings
															.provider
													}
												</small>
											</td>
											<td data-label="Revision">
												v
												{
													agent.revision
												}
											</td>
											<td data-label="Tools">
												{
													agent.tool_count
												}
											</td>
											<td data-label="Availability">
												{agent.enabled
													? 'Enabled'
													: 'Disabled'}
											</td>
											<td data-label="Action"><div className="table-row-actions">
												<button
													className='button'
													aria-label={`Manage ${agent.name}`}
													onClick={e =>
														onSelect(
															agent,
															e.currentTarget,
														)
													}>
													Manage
												</button>
												<button
													className='button'
													aria-label={`Playground ${agent.name}`}
													onClick={e =>
														onPlayground(
															agent,
															e.currentTarget,
														)
													}>
													Playground
												</button>
                                                {canRemove && <button className='button destructive' aria-label={`Remove ${agent.name}`} onClick={event => { removeButton.current = event.currentTarget; setRemoveError(''); setRemoveTarget(agent); }}>Remove</button>}
                                            </div>

											</td>
										</tr>
									),
								)}
							</tbody>
						</table>
					</div>
				)
			)}
			{offset !== null && (
				<div className='mcp-feedback'>
					<button
						className='button'
						disabled={loading}
						onClick={() => void more()}>
						Load more agents
					</button>
				</div>
			)}
            <dialog ref={removeDialog} className='benchmark-run-dialog' aria-labelledby='remove-agent-title'
                onCancel={event => { if (removing) event.preventDefault(); else setRemoveTarget(null); }}
                onClose={() => { setRemoveTarget(null); if (removeButton.current?.isConnected) removeButton.current.focus(); }}>
                <h2 id='remove-agent-title'>Remove agent?</h2>
                <p>Remove <strong>{removeTarget?.name}</strong> from the agent list? Saved revisions, executions and benchmark results will be kept.</p>
                {removeError && <p role='alert' className='project-error'>{removeError}</p>}
                <div className='table-row-actions'>
                    <button className='button' autoFocus disabled={removing} onClick={() => setRemoveTarget(null)}>Cancel</button>
                    <button className='button destructive' disabled={removing} onClick={removeAgent}>{removing ? 'Removing…' : 'Confirm remove'}</button>
                </div>
            </dialog>

		</>
	);
}
