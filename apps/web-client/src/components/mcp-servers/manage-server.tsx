'use client';
import Link from 'next/link';
import { PlugZap, RefreshCw, Settings2, Wrench, X } from 'lucide-react';
import type { McpServer } from '@/types/mcp-server';
import { ServerForm } from './server-form';
import { useManageServer } from './use-manage-server';

export type DiscoveredTool = {
	name: string;
	description: string | null;
	input_schema: Record<string, unknown>;
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
	const {
		dialog,
		server,
		tools,
		operation,
		editing,
		setEditing,
		setSaving,
		error,
		setError,
		notice,
		setNotice,
		setDenied,
		editButton,
		editable,
		busy,
		apply,
		check,
		discover,
		toggle,
		dismiss,
	} = useManageServer({ server: initial, projectId, canManage, onClose, onUpdated, onDenied });
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
										{server.endpoint}
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
												dateTime={server.last_checked_at}>
												{new Date(server.last_checked_at).toLocaleString()}
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
									aria-checked={server.enabled}
									aria-label={`Enable ${server.name}`}
									disabled={busy}
									onClick={() => void toggle()}>
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
												{tools.length}
											</span>
										)}
								</h3>
								{editable && (
									<button
										className='button'
										disabled={busy}
										onClick={() => void discover()}>
										<RefreshCw
											size={15}
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
										size={18}
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
										size={18}
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
												key={tool.name}>
												<summary>
													<Wrench
														size={14}
														aria-hidden
													/>
													<span className='mcp-tool-name'>
														{tool.name}
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
													{JSON.stringify(tool.input_schema, null, 2)}
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
									size={15}
									aria-hidden
								/>{' '}
								Edit connection
							</button>
							<button
								className='button primary'
								disabled={busy}
								onClick={() => void check()}>
								<PlugZap
									size={15}
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
