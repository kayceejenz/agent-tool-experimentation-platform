'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { projectRequest, ProjectRequestError } from '@/lib/projects/client';
import type { McpServer } from '@/types/mcp-server';

type Props = {
	projectId: string;
	server: McpServer | null;
	onClose: () => void;
	onSaved: (server: McpServer) => void;
	onDenied: () => void;
};
export function ServerForm({
	projectId,
	server,
	onClose,
	onSaved,
	onDenied,
}: Props) {
	const dialog = useRef<HTMLDialogElement>(null);
	const nameInput = useRef<HTMLInputElement>(null);
	const [name, setName] = useState(server?.name ?? '');
	const [endpoint, setEndpoint] = useState(server?.endpoint ?? '');
	const [auth, setAuth] = useState<'none' | 'bearer'>(
		server?.auth_type ?? 'none',
	);
	const [credential, setCredential] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [denied, setDenied] = useState(false);
	const needsCredential =
		auth === 'bearer' &&
		(!server?.credential_configured ||
			server.auth_type !== 'bearer' ||
			endpoint.trim() !== server.endpoint);
	useEffect(() => {
		const element = dialog.current;
		element?.showModal();
		nameInput.current?.focus();
		return () => element?.close();
	}, []);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || denied) return;
		if (!name.trim()) {
			setError('Enter a server name.');
			return;
		}
		try {
			const url = new URL(endpoint.trim());
			if (
				!['https:', 'http:'].includes(url.protocol) ||
				url.username ||
				url.password ||
				url.search ||
				url.hash
			)
				throw new Error();
		} catch {
			setError(
				'Enter an HTTP or HTTPS endpoint without credentials, query parameters, or fragments.',
			);
			return;
		}
		if (needsCredential && !credential) {
			setError('Enter a bearer token for this endpoint.');
			return;
		}
		setBusy(true);
		setError('');
		try {
			const result = await projectRequest<McpServer>(
				`/${projectId}/mcp-servers${server ? `/${server.id}` : ''}`,
				{
					method: server ? 'PATCH' : 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						name: name.trim(),
						endpoint: endpoint.trim(),
						auth_type: auth,
						...(auth === 'bearer' &&
						credential
							? { credential }
							: {}),
					}),
				},
			);
			setCredential('');
			onSaved(result);
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: 'Unable to save this connection.',
			);
			if (
				error instanceof ProjectRequestError &&
				[403, 404].includes(error.status)
			) {
				setCredential('');
				setDenied(true);
				onDenied();
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<dialog
			ref={dialog}
			className='mcp-dialog'
			aria-labelledby='mcp-form-title'
			onCancel={event => {
				event.preventDefault();
				if (!busy) onClose();
			}}>
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
					onChange={event =>
						setName(event.target.value)
					}
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
					onChange={event =>
						setEndpoint(event.target.value)
					}
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
							required={
								needsCredential
							}
							maxLength={8192}
							autoComplete='new-password'
							spellCheck={false}
							disabled={
								busy || denied
							}
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
		</dialog>
	);
}
