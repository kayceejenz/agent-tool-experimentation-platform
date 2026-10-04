'use client';
import Link from 'next/link';
import type { ToolPage } from '@/types/tool';
import { useEffect, useRef, useState } from 'react';
import { PlugZap, RefreshCw, Settings2, Wrench, X } from 'lucide-react';
import type { McpServer } from '@/types/mcp-server';
import { projectRequest, ProjectRequestError } from '@/lib/projects/client';
import { ServerForm } from './server-form';
import { checkErrors } from './check-errors';

export type DiscoveredTool = {
	name: string;
	description: string | null;
	input_schema: Record<string, unknown>;
};
type ProbeResult = {
	server: McpServer;
	tools: DiscoveredTool[] | null;
};

const statusLabels: Record<McpServer['connection_status'], string> = {
	untested: 'Not checked',
	connected: 'Connected',
	error: 'Check failed',
};

type Props = {
	server: McpServer;
	projectId: string;
	canManage: boolean;
	onClose: () => void;
	onUpdated: (server: McpServer) => void;
	onDenied: () => void;
};

export function ManageServer({
	server: initial,
	projectId,
	canManage,
	onClose,
	onUpdated,
	onDenied,
}: Props) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [server, setServer] = useState(initial);
	const [tools, setTools] = useState<DiscoveredTool[] | null>(null);
	const [operation, setOperation] = useState<
		'check' | 'discover' | 'toggle' | null
	>(null);
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	const [denied, setDenied] = useState(false);
	const editButton = useRef<HTMLButtonElement>(null);
	const editable = canManage && !denied;
	const busy = operation !== null || saving;

	useEffect(() => {
		const element = dialog.current;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		element?.showModal();
		return () => {
			element?.close();
			document.body.style.overflow = previousOverflow;
		};
	}, []);

	useEffect(() => {
		let active = true;
		void projectRequest<ToolPage>(
			`/${projectId}/tools?server_id=${initial.id}`,
		)
			.then(page => {
				if (active)
					setTools(
						page.items.map(tool => ({
							name: tool.name,
							description:
								tool.definition
									.description ??
								null,
							input_schema:
								tool.definition
									.input_schema,
						})),
					);
			})
			.catch(() => {
				if (active)
					setError('Unable to load saved tools.');
			});
		return () => {
			active = false;
		};
	}, [projectId, initial.id]);

	function request<T>(path: string, init?: RequestInit) {
		return projectRequest<T>(
			`/${projectId}/mcp-servers/${path}`,
			init,
		);
	}

	function apply(next: McpServer) {
		setServer(next);
		onUpdated(next);
	}

	function fail(error: unknown, fallback: string) {
		setError(error instanceof Error ? error.message : fallback);
		if (
			error instanceof ProjectRequestError &&
			[403, 404].includes(error.status)
		) {
			setDenied(true);
			onDenied();
		}
	}

	async function check() {
		if (busy || !editable) return;
		setOperation('check');
		setError('');
		setNotice('');
		try {
			const result = await request<ProbeResult>(
				`${server.id}/check`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: '{}',
				},
			);

			apply(result.server);

			if (result.server.connection_status === 'error') {
				setError(
					checkErrors[
						result.server.last_error_code ??
							''
					] ??
						'Unable to reach this MCP server. Verify the endpoint and try again.',
				);
			} else {
				setNotice(
					`${result.server.name} responded successfully.`,
				);
			}
		} catch (error) {
			fail(error, 'Unable to check this connection.');
		} finally {
			setOperation(null);
		}
	}

	async function discover() {
		if (busy || !editable) return;
		setOperation('discover');
		setError('');
		setNotice('');

		try {
			const result = await request<ProbeResult>(
				`${server.id}/discover`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: '{}',
				},
			);
			apply(result.server);
			if (result.tools !== null) setTools(result.tools);
			if (result.server.connection_status === 'error') {
				setError(
					checkErrors[
						result.server.last_error_code ??
							''
					] ??
						'Unable to reach this MCP server. Verify the endpoint and try again.',
				);
			} else {
				setNotice(
					`${result.tools?.length ?? 0} ${
						result.tools?.length === 1
							? 'tool'
							: 'tools'
					} discovered.`,
				);
			}
		} catch (error) {
			fail(error, 'Unable to discover tools.');
		} finally {
			setOperation(null);
		}
	}

	async function toggle() {
		if (busy || !editable) return;
		setOperation('toggle');
		setError('');
		setNotice('');
		try {
			const updated = await request<McpServer>(server.id, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					enabled: !server.enabled,
				}),
			});
			apply(updated);
			setNotice(
				`${updated.name} ${
					updated.enabled ? 'enabled' : 'disabled'
				}.`,
			);
		} catch (error) {
			fail(error, 'Unable to change availability.');
		} finally {
			setOperation(null);
		}
	}

	function dismiss() {
		if (busy) return;
		if (editing) {
			setEditing(false);
			requestAnimationFrame(() =>
				editButton.current?.focus(),
			);
			return;
		}
		onClose();
	}

	return (
		<dialog
			ref={dialog}
			className='mcp-sheet'
			aria-labelledby='mcp-sheet-title'
			onCancel={event => {
				event.preventDefault();
				dismiss();
			}}>
			<header className='mcp-sheet-header'>
				<div className='mcp-sheet-heading'>
					<h2 id='mcp-sheet-title'>
						{server.name}
					</h2>
				</div>
				<button
					type='button'
					className='mcp-icon-button'
					aria-label='Close server management'
					disabled={busy}
					onClick={dismiss}>
					<X size={20} aria-hidden />
				</button>
			</header>

			{editing ? (
				<ServerForm
					inline
					projectId={projectId}
					server={server}
					onClose={dismiss}
					onBusyChange={setSaving}
					onSaved={next => {
						apply(next);
						setEditing(false);
						setNotice('Connection saved.');
						requestAnimationFrame(() =>
							editButton.current?.focus(),
						);
					}}
					onDenied={() => {
						setDenied(true);
						onDenied();
					}}
				/>
			) : (
				<>
					<div className='mcp-sheet-body'>
						{error && (
							<p
								className='mcp-sheet-message mcp-error'
								role='alert'>
								{error}
							</p>
						)}
						{notice && (
							<p
								className='mcp-sheet-message'
								role='status'>
								{notice}
							</p>
						)}
						{!editable && (
							<p className='mcp-note mcp-sheet-note'>
								You have
								read-only access
								to this
								connection.
							</p>
						)}

						<section className='mcp-sheet-section'>
							<div className='mcp-sheet-section-heading'>
								<h3>
									Overview
								</h3>
								<span
									className={`mcp-status ${server.connection_status}`}>
									{
										statusLabels[
											server
												.connection_status
										]
									}
								</span>
							</div>
							<dl className='mcp-sheet-details'>
								<div>
									<dt>
										Endpoint
									</dt>
									<dd className='mcp-sheet-endpoint'>
										{
											server.endpoint
										}
									</dd>
								</div>
								<div>
									<dt>
										Transport
									</dt>
									<dd>
										Streamable
										HTTP
									</dd>
								</div>
								<div>
									<dt>
										Authentication
									</dt>
									<dd>
										{server.auth_type ===
										'none'
											? 'None'
											: `Bearer token · ${server.credential_configured ? 'Configured' : 'Missing'}`}
									</dd>
								</div>
								<div>
									<dt>
										Last
										checked
									</dt>
									<dd>
										{server.last_checked_at ? (
											<time
												dateTime={
													server.last_checked_at
												}>
												{new Date(
													server.last_checked_at,
												).toLocaleString()}
											</time>
										) : (
											'Not checked yet'
										)}
									</dd>
								</div>
							</dl>
						</section>

						<section className='mcp-sheet-section mcp-sheet-split'>
							<div>
								<h3>
									Availability
								</h3>
								<p>
									Allow
									this
									connection
									to be
									used by
									the
									project.
								</p>
							</div>
							{editable ? (
								<button
									className='mcp-toggle'
									type='button'
									role='switch'
									aria-checked={
										server.enabled
									}
									aria-label={`Enable ${server.name}`}
									disabled={
										busy
									}
									onClick={() =>
										void toggle()
									}>
									<span
										aria-hidden
									/>
									<span>
										{operation ===
										'toggle'
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
						</section>

						<section className='mcp-sheet-section'>
							<div className='mcp-sheet-section-heading'>
								<h3>
									Tools
									{tools !==
										null && (
										<span className='mcp-tool-count'>
											{
												tools.length
											}
										</span>
									)}
								</h3>
								{editable && (
									<button
										className='button'
										disabled={
											busy
										}
										onClick={() =>
											void discover()
										}>
										<RefreshCw
											size={
												15
											}
											aria-hidden
										/>{' '}
										{operation ===
										'discover'
											? 'Discovering…'
											: !tools?.length
												? 'Discover'
												: 'Refresh'}
									</button>
								)}
							</div>
							<p className='mcp-section-description'>
								Inspect the
								tools this
								server provides.
								Discovery never
								executes them.
							</p>
							<Link
								className='text-link'
								href={`/projects/${projectId}/tools`}>
								Manage and test
								saved tools
							</Link>
							{tools === null ? (
								<div className='mcp-tools-empty'>
									<Wrench
										size={
											18
										}
										aria-hidden
									/>
									<span>
										Discover
										tools
										to
										see
										their
										descriptions
										and
										inputs.
									</span>
								</div>
							) : tools.length ===
							  0 ? (
								<div className='mcp-tools-empty'>
									<Wrench
										size={
											18
										}
										aria-hidden
									/>
									<span>
										This
										server
										exposes
										no
										tools.
									</span>
								</div>
							) : (
								<div className='mcp-tool-list'>
									{tools.map(
										tool => (
											<details
												className='mcp-tool'
												key={
													tool.name
												}>
												<summary>
													<Wrench
														size={
															14
														}
														aria-hidden
													/>
													<span className='mcp-tool-name'>
														{
															tool.name
														}
													</span>
												</summary>
												<p className='mcp-tool-description'>
													{tool.description ||
														'No description provided.'}
												</p>
												<h4>
													Input
													schema
												</h4>
												<pre>
													{JSON.stringify(
														tool.input_schema,
														null,
														2,
													)}
												</pre>
											</details>
										),
									)}
								</div>
							)}
						</section>
					</div>

					{editable && (
						<footer className='mcp-sheet-footer'>
							<button
								ref={editButton}
								className='button'
								disabled={busy}
								onClick={() => {
									setError(
										'',
									);
									setNotice(
										'',
									);
									setEditing(
										true,
									);
								}}>
								<Settings2
									size={
										15
									}
									aria-hidden
								/>{' '}
								Edit connection
							</button>
							<button
								className='button primary'
								disabled={busy}
								onClick={() =>
									void check()
								}>
								<PlugZap
									size={
										15
									}
									aria-hidden
								/>{' '}
								{operation ===
								'check'
									? 'Checking…'
									: server.last_checked_at
										? 'Check again'
										: 'Check connection'}
							</button>
						</footer>
					)}
				</>
			)}
		</dialog>
	);
}
