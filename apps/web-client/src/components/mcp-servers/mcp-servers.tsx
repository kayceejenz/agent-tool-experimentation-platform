'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Settings2 } from 'lucide-react';
import type { Project } from '@/types/workspace';
import type { McpServer, McpServerPage } from '@/types/mcp-server';
import { projectRequest, ProjectRequestError } from '@/lib/projects/client';
import { ProjectSync } from '@/components/projects/project-provider';
import { projectWrite } from '@/lib/projects/client';

const ServerForm = dynamic(() => import('./server-form').then(module => module.ServerForm), { loading: () => <p role='status'>Loading dialog…</p> });


const ManageServer = dynamic(() => import('./manage-server').then(module => module.ManageServer), { loading: () => <p role='status'>Loading dialog…</p> });


export function McpServers({ project }: { project: Project }) {
	const [servers, setServers] = useState<McpServer[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	const [creating, setCreating] = useState(false);
	const [managing, setManaging] = useState<McpServer | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [denied, setDenied] = useState(false);
	const generation = useRef(0);
	const opener = useRef<HTMLElement | null>(null);
	const canManage = project.role !== 'viewer' && !denied;
	const base = `/${project.id}/mcp-servers`;

	const load = useCallback(
		async (after?: string) => {
			const requestId = ++generation.current;
			try {
				const page =
					await projectRequest<McpServerPage>(
						base +
						(after
							? `?cursor=${encodeURIComponent(after)}`
							: ''),
					);
				if(requestId !== generation.current) return;
				setServers(old =>
					after
						? [
							...new Map(
								[
									...old,
									...page.items,
								].map(
									server => [
										server.id,
										server,
									],
								),
							).values(),
						]
						: page.items,
				);
				setCursor(page.next_cursor);
			} catch(error) {
				if(requestId !== generation.current) return;
				setError(
					error instanceof Error
						? error.message
						: 'Unable to load connections.',
				);
				if(
					error instanceof ProjectRequestError &&
					[403, 404].includes(error.status)
				) {
					setDenied(true);
					setServers([]);
				}
			} finally {
				if(requestId === generation.current)
					setLoading(false);
			}
		},
		[base],
	);

	useEffect(() => {
		const counter = generation;
		const requestId = ++counter.current;
		void projectRequest<McpServerPage>(base)
			.then(page => {
				if(requestId !== counter.current) return;
				setServers(page.items);
				setCursor(page.next_cursor);
			})
			.catch(error => {
				if(requestId !== counter.current) return;
				setError(
					error instanceof Error
						? error.message
						: 'Unable to load connections.',
				);
				if(
					error instanceof ProjectRequestError &&
					[403, 404].includes(error.status)
				)
					setDenied(true);
			})
			.finally(() => {
				if(requestId === counter.current)
					setLoading(false);
			});
		return () => {
			counter.current++;
		};
	}, [base]);

	function refresh(after?: string) {
		setLoading(true);
		setError('');
		void load(after);
	}

	function upsert(server: McpServer) {
		setServers(old =>
			old.some(item => item.id === server.id)
				? old.map(item =>
					item.id === server.id
						? server
						: item,
				)
				: [server, ...old],
		);
	}

	function open(server: McpServer | null) {
		opener.current = document.activeElement as HTMLElement;
		setNotice('');
		setError('');
		if(server) setManaging(server);
		else setCreating(true);
	}

	function close() {
		setManaging(null);
		setCreating(false);
		requestAnimationFrame(() => opener.current?.focus());
	}

	function saved(server: McpServer) {
		upsert(server);
		setNotice('Connection saved.');
		close();
	}

	async function toggle(server: McpServer) {
		if(busyId || !canManage) return;
		setBusyId(server.id);
		setError('');
		setNotice('');
		try {
			const updated = await projectWrite<McpServer>(`${base}/${server.id}`, 'PATCH', {
				enabled: !server.enabled,
			});
			upsert(updated);
			setNotice(
				`${updated.name} ${updated.enabled ? 'enabled' : 'disabled'}.`,
			);
		} catch(error) {
			setError(
				error instanceof Error
					? error.message
					: 'Unable to change this connection.',
			);
			if(
				error instanceof ProjectRequestError &&
				[403, 404].includes(error.status)
			)
				setDenied(true);
		} finally {
			setBusyId(null);
		}
	}

	return (
		<>
			<ProjectSync project={project} />
			<header className='workspace-header'>
				<div>
					<h1>MCP Servers</h1>
					<p>
						Manage the connections available
						to {project.name}.
					</p>
				</div>
				<div className='mcp-header-actions'>
					<button
						className='button'
						disabled={
							loading ||
							Boolean(busyId)
						}
						onClick={() => refresh()}>
						<RefreshCw
							size={16}
							aria-hidden
						/>{' '}
						Refresh
					</button>
					{canManage && (
						<button
							className='button primary'
							disabled={
								loading ||
								Boolean(busyId)
							}
							onClick={() => open(null)}>
							<Plus
								size={16}
								aria-hidden
							/>{' '}
							Add server
						</button>
					)}
				</div>
			</header>
			{!canManage && (
				<p className='mcp-note'>
					You can view connections. An owner or
					editor can manage them.
				</p>
			)}
			{error && (
				<div
					className='mcp-feedback mcp-error'
					role='alert'>
					<p>{error}</p>
					<button
						className='button'
						disabled={loading}
						onClick={() => refresh()}>
						Try again
					</button>
				</div>
			)}
			{notice && (
				<p role='status' className='mcp-feedback'>
					{notice}
				</p>
			)}
			<section
				className='panel mcp-panel'
				aria-label='MCP connections'
				aria-busy={loading}>
				{loading && (
					<p
						className='mcp-feedback'
						role='status'>
						Loading connections…
					</p>
				)}
				{!loading && !error && !servers.length && (
					<div className='empty-state'>
						<h2>No MCP servers yet</h2>
						<p>
							{canManage
								? 'Add a server endpoint to configure your first connection.'
								: 'Connections added by an owner or editor will appear here.'}
						</p>
					</div>
				)}
				{servers.length > 0 && (
					<div
						className='mcp-table-scroll'
						role='region'
						aria-label='MCP server table'
						tabIndex={0}>
						<table
							className='mcp-table'
							aria-label='MCP servers'>
							<thead>
								<tr>
									<th
										scope='col'
										className='mcp-server-column'>
										Server
									</th>

									<th
										scope='col'
										className='mcp-auth-column'>
										Authentication
									</th>
									<th
										scope='col'
										className='mcp-check-column'>
										Connection
									</th>
									<th
										scope='col'
										className='mcp-enabled-column'>
										Enabled
									</th>
									<th
										scope='col'
										className='mcp-actions-column'>
										<span className='visually-hidden'>
											Manage
										</span>
									</th>
								</tr>
							</thead>
							<tbody>
								{servers.map(
									server => (
										<tr
											key={server.id}
											aria-label={server.name}>
											<th scope='row'>
												<div className='mcp-identity'>
													<div>
														<span className='mcp-name'>
															{server.name}
														</span>
														<p className='mcp-endpoint'>
															{server.endpoint}
														</p>
														<span className='mcp-meta'>
															Streamable
															HTTP
														</span>
													</div>
												</div>
											</th>

											<td>
												{server.auth_type ===
													'none' ? (
													'None'
												) : (
													<>
														<span>
															Bearer
															token
														</span>
														<span className='mcp-cell-detail'>
															{server.credential_configured
																? 'Configured'
																: 'Missing'}
														</span>
													</>
												)}
											</td>
											<td>
												<span
													className={`mcp-status ${server.connection_status}`}>
													{server.connection_status ===
														'untested'
														? 'Not checked'
														: server.connection_status ===
															'connected'
															? 'Connected'
															: 'Check failed'}
												</span>
											</td>
											<td>
												{canManage ? (
													<button
														className='mcp-toggle'
														type='button'
														role='switch'
														aria-checked={server.enabled}
														aria-label={`Enable ${server.name}`}
														disabled={
															loading ||
															Boolean(
																busyId,
															)
														}
														onClick={() => void toggle(server)}>
														<span
															aria-hidden
														/>
														<span>
															{busyId ===
																server.id
																? 'Saving…'
																: server.enabled
																	? 'Enabled'
																	: 'Disabled'}
														</span>
													</button>
												) : (
													<span className='badge'>
														{server.enabled
															? 'Enabled'
															: 'Disabled'}
													</span>
												)}
											</td>
											<td className='mcp-actions-column'>
												<button
													className='mcp-action'
													aria-label={`Manage ${server.name}`}
													disabled={
														loading ||
														Boolean(
															busyId,
														)
													}
													onClick={() => open(server)}>
													<Settings2
														size={15}
														aria-hidden
													/>{' '}
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
				{cursor && !loading && !error && (
					<div className='mcp-feedback'>
						<button
							className='button'
							onClick={() => refresh(cursor)}>
							Load more servers
						</button>
					</div>
				)}
			</section>
			{creating && (
				<ServerForm
					key='new'
					projectId={project.id}
					server={null}
					onClose={close}
					onSaved={saved}
					onDenied={() => setDenied(true)}
				/>
			)}
			{managing && (
				<ManageServer
					key={managing.id}
					server={managing}
					projectId={project.id}
					canManage={canManage}
					onClose={close}
					onUpdated={upsert}
					onDenied={() => setDenied(true)}
				/>
			)}
		</>
	);
}
