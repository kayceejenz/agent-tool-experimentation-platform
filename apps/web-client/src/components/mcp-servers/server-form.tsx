'use client';
import { X } from 'lucide-react';
import type { McpServer } from '@/types/mcp-server';
import { useServerForm } from './use-server-form';

type Props = {
	inline?: boolean;
	onBusyChange?: (busy: boolean) => void;
	projectId: string;
	server: McpServer | null;
	onClose: () => void;
	onSaved: (server: McpServer) => void;
	onDenied: () => void;
};


export function ServerForm({
	projectId,
	inline = false,
	onBusyChange,
	server,
	onClose,
	onSaved,
	onDenied,
}: Props) {
	const {
		dialog,
		nameInput,
		name,
		setName,
		endpoint,
		setEndpoint,
		auth,
		setAuth,
		credential,
		setCredential,
		busy,
		error,
		denied,
		needsCredential,
		submit,
	} = useServerForm({ projectId, inline, onBusyChange, server, onClose, onSaved, onDenied });
	const content = (
		<>
			<div className='mcp-dialog-heading'>
				<h2 id='mcp-form-title'>
					{server
						? 'Edit MCP server'
						: 'Add MCP server'}
				</h2>
				<button
					type='button'
					className='mcp-icon-button'
					aria-label='Close connection form'
					disabled={busy}
					onClick={onClose}>
					<X size={20} aria-hidden />
				</button>
			</div>
			<form
				className='mcp-form'
				onSubmit={submit}
				aria-busy={busy}>
				{error && (
					<p className='mcp-error' role='alert'>
						{error}
					</p>
				)}
				<label htmlFor='mcp-name'>Server name</label>
				<input
					ref={nameInput}
					id='mcp-name'
					value={name}
					onChange={event => setName(event.target.value)}
					maxLength={160}
					required
					disabled={busy || denied}
				/>
				<label htmlFor='mcp-endpoint'>
					Endpoint URL
				</label>
				<input
					id='mcp-endpoint'
					type='url'
					value={endpoint}
					onChange={event => setEndpoint(event.target.value)}
					maxLength={2048}
					required
					placeholder='https://tools.example.com/mcp'
					disabled={busy || denied}
					aria-describedby='mcp-endpoint-hint'
				/>
				<small id='mcp-endpoint-hint'>
					Use HTTPS. Local HTTP endpoints must be
					allowed by your administrator.
				</small>
				<div className='mcp-transport'>
					<span>Transport</span>
					<strong>Streamable HTTP</strong>
				</div>
				<label htmlFor='mcp-auth'>Authentication</label>
				<select
					id='mcp-auth'
					value={auth}
					onChange={event => {
						setAuth(
							event.target.value as
							| 'none'
							| 'bearer',
						);
						setCredential('');
					}}
					disabled={busy || denied}>
					<option value='none'>None</option>
					<option value='bearer'>
						Bearer token
					</option>
				</select>
				{auth === 'bearer' && (
					<>
						<label htmlFor='mcp-credential'>
							{server?.credential_configured
								? 'Replacement bearer token'
								: 'Bearer token'}
						</label>
						<input
							id='mcp-credential'
							type='password'
							value={credential}
							onChange={event =>
								setCredential(
									event
										.target
										.value,
								)
							}
							required={needsCredential}
							maxLength={8192}
							autoComplete='new-password'
							spellCheck={false}
							disabled={busy || denied}
							aria-describedby='mcp-token-hint'
						/>
						<small id='mcp-token-hint'>
							{needsCredential
								? 'A token is required for this endpoint.'
								: 'Leave blank to keep the saved token.'}{' '}
							Saved tokens are never
							displayed.
						</small>
					</>
				)}
				{server?.credential_configured &&
					auth === 'none' && (
						<p className='mcp-note'>
							Saving will remove the
							stored token.
						</p>
					)}
				<p className='mcp-note'>
					{server
						? 'Changing the endpoint or authentication disables the connection and resets its check status.'
						: 'New connections start disabled and untested.'}
				</p>
				<div className='mcp-form-actions'>
					<button
						className='button primary'
						type='submit'
						disabled={busy || denied}>
						{busy
							? 'Saving…'
							: server
								? 'Save connection'
								: 'Add server'}
					</button>
					<button
						className='button'
						type='button'
						disabled={busy}
						onClick={onClose}>
						Cancel
					</button>
				</div>
			</form>
		</>
	);
	if(inline) return <div className='mcp-inline-form'>{content}</div>;
	return (
		<dialog
			ref={dialog}
			className='mcp-dialog'
			aria-labelledby='mcp-form-title'
			onCancel={event => {
				event.preventDefault();
				if(!busy) onClose();
			}}>
			{content}
		</dialog>
	);
}
