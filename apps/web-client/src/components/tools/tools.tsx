'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectSync } from '@/components/projects/project-provider';
import { projectRequest } from '@/lib/projects/client';
import type { Project } from '@/types/workspace';
import type { Tool, ToolPage } from '@/types/tool';
import { projectWrite } from '@/lib/projects/client';

const ToolTester = dynamic(
	() => import('./tool-tester').then(module => module.ToolTester),
	{ loading: () => <p role='status'>Loading dialog…</p> },
);

export function Tools({ project }: { project: Project }) {
	const [tools, setTools] = useState<Tool[]>([]);
	const [offset, setOffset] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [selected, setSelected] = useState<Tool | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const opener = useRef<HTMLElement | null>(null);
	const generation = useRef(0);
	const base = `/${project.id}/tools`;
	const canManage = project.role !== 'viewer';
	const load = useCallback(
		async (after = 0) => {
			const id = ++generation.current;
			try {
				const page = await projectRequest<ToolPage>(
					`${base}?offset=${after}`,
				);
				if (id !== generation.current) return;
				setError('');
				setTools(old =>
					after
						? [...old, ...page.items]
						: page.items,
				);
				setOffset(page.next_offset);
			} catch (e) {
				if (id === generation.current)
					setError(
						e instanceof Error
							? e.message
							: 'Unable to load tools.',
					);
			} finally {
				if (id === generation.current)
					setLoading(false);
			}
		},
		[base],
	);
	useEffect(() => {
		const counter = generation;
		const id = ++counter.current;
		void projectRequest<ToolPage>(base)
			.then(page => {
				if (counter.current !== id) return;
				setTools(page.items);
				setOffset(page.next_offset);
			})
			.catch(e => {
				if (counter.current === id) setError(e.message);
			})
			.finally(() => {
				if (counter.current === id) setLoading(false);
			});
		return () => {
			counter.current++;
		};
	}, [base]);
	async function toggle(tool: Tool) {
		setBusy(tool.id);
		setError('');
		try {
			const updated = await projectWrite<Tool>(
				`${base}/${tool.id}`,
				'PATCH',
				{
					enabled: !tool.enabled,
					revision: tool.revision,
				},
			);
			setTools(old =>
				old.map(t => (t.id === tool.id ? updated : t)),
			);
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to update tool.',
			);
		} finally {
			setBusy(null);
		}
	}
	return (
		<>
			<ProjectSync project={project} />
			<header className='workspace-header'>
				<div>
					<h1>Tools</h1>
					<p>
						Review discovered tools and test
						them with your own inputs.
					</p>
				</div>
				<button
					className='button'
					disabled={loading || !!busy}
					onClick={() => {
						setLoading(true);
						void load();
					}}>
					Refresh
				</button>
			</header>
			<section className='panel'>
				<div className='tool-intro'>
					<p>
						New and changed tools start
						disabled. Both the connection
						and tool must be enabled to run
						a test.
					</p>
					<Link
						className='text-link'
						href={`/projects/${project.id}/servers`}>
						Manage MCP servers
					</Link>
				</div>
				{error && (
					<p
						className='mcp-feedback mcp-error'
						role='alert'>
						{error}
					</p>
				)}
				{loading && !tools.length ? (
					<p
						className='mcp-feedback'
						role='status'>
						Loading tools…
					</p>
				) : !tools.length ? (
					<div className='empty-state'>
						<h2>No tools discovered</h2>
						<p>
							Open an MCP server and
							choose Discover to save
							its tools here.
						</p>
					</div>
				) : (
					<div className='tool-table-wrap'>
						<table className='tool-table'>
							<thead>
								<tr>
									<th>
										Tool
									</th>
									<th>
										MCP
										server
									</th>
									<th>
										Availability
									</th>
									<th>
										Action
									</th>
								</tr>
							</thead>
							<tbody>
								{tools.map(
									tool => (
										<tr
											key={
												tool.id
											}>
											<td>
												<strong>
													{
														tool.name
													}
												</strong>
												<p className='tool-description'>
													{tool
														.definition
														.description ||
														'No description provided.'}
												</p>
												<small>
													Revision{' '}
													{
														tool.revision
													}
												</small>
											</td>
											<td>
												{
													tool.server_name
												}
												<small>
													{tool.server_enabled
														? 'Connection enabled'
														: 'Connection disabled'}
												</small>
											</td>
											<td>
												<button
													type='button'
													className='mcp-toggle'
													role='switch'
													aria-label={`Enable ${tool.name} on ${tool.server_name}`}
													aria-checked={
														tool.enabled
													}
													disabled={
														!canManage ||
														!!busy ||
														!tool.available
													}
													onClick={() =>
														void toggle(
															tool,
														)
													}>
													<span
														aria-hidden
													/>
													<span>
														{tool.enabled
															? 'Enabled'
															: 'Disabled'}
													</span>
												</button>
												{!tool.available && (
													<small>
														Rediscovery
														required
													</small>
												)}
											</td>
											<td>
												<button
													className='button'
													onClick={event => {
														opener.current =
															event.currentTarget;
														setSelected(
															tool,
														);
													}}>
													Manage
												</button>
											</td>
										</tr>
									),
								)}
							</tbody>
						</table>
					</div>
				)}
				{offset !== null && (
					<div className='mcp-feedback'>
						<button
							className='button'
							disabled={loading}
							onClick={() => {
								setLoading(
									true,
								);
								void load(
									offset,
								);
							}}>
							Load more
						</button>
					</div>
				)}
			</section>
			{selected && (
				<ToolTester
					key={selected.id}
					projectId={project.id}
					tool={selected}
					canManage={canManage}
					onClose={() => {
						setSelected(null);
						requestAnimationFrame(() =>
							opener.current?.focus(),
						);
					}}
				/>
			)}
		</>
	);
}
