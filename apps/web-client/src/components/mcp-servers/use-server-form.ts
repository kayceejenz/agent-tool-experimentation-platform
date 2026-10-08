'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ProjectRequestError } from '@/lib/projects/client';
import { checkErrors } from './check-errors';
import type { McpServer } from '@/types/mcp-server';
import { projectWrite } from '@/lib/projects/client';
import { useModalDialog } from '@/hooks/use-modal-dialog';

type Props = {
	inline?: boolean;
	onBusyChange?: (busy: boolean) => void;
	projectId: string;
	server: McpServer | null;
	onClose: () => void;
	onSaved: (server: McpServer) => void;
	onDenied: () => void;
};

export function useServerForm({
	projectId,
	inline = false,
	onBusyChange,
	server,
	onSaved,
	onDenied,
}: Props) {
	const dialog = useModalDialog(!inline);
	const nameInput = useRef<HTMLInputElement>(null);
	const [name, setName] = useState(server?.name ?? '');
	const [endpoint, setEndpoint] = useState(server?.endpoint ?? '');
	const [auth, setAuth] = useState<'none' | 'bearer'>(
		server?.auth_type ?? 'none',
	);
	const [credential, setCredential] = useState('');
	const [busy, setBusy] = useState(false);
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState('');
	const [denied, setDenied] = useState(false);
	const needsCredential =
		auth === 'bearer' &&
		(!server?.credential_configured ||
			server.auth_type !== 'bearer' ||
			endpoint.trim() !== server.endpoint);
	useEffect(() => { nameInput.current?.focus(); }, []);

	function validate(): string | null {
		if(!name.trim()) return 'Enter a server name.';
		try {
			const url = new URL(endpoint.trim());
			if(
				!['https:', 'http:'].includes(url.protocol) ||
				url.username ||
				url.password ||
				url.search ||
				url.hash
			)
				throw new Error();
		} catch {
			return 'Enter an HTTP or HTTPS endpoint without credentials, query parameters, or fragments.';
		}
		if(needsCredential && !credential)
			return 'Enter a bearer token for this endpoint.';
		return null;
	}

	async function testConnection(): Promise<boolean> {
		if(checking) return false;
		const invalid = validate();
		if(invalid) {
			setError(invalid);
			return false;
		}
		setChecking(true);
		setError('');
		try {
			const result = await projectWrite<{
				reachable: boolean;
				error_code: string | null;
			}>(`/${projectId}/mcp-servers/probe`, 'POST', {
				endpoint: endpoint.trim(),
				auth_type: auth,
				...(auth === 'bearer' && credential
					? { credential }
					: {}),
			});
			if(!result.reachable) {
				setError(
					checkErrors[result.error_code ?? ''] ??
					'Unable to reach this MCP server. Verify the endpoint and try again.',
				);
				return false;
			}
			return true;
		} catch(error) {
			setError(
				error instanceof Error
					? error.message
					: 'Unable to verify this connection.',
			);
			if(
				error instanceof ProjectRequestError &&
				[403, 404].includes(error.status)
			) {
				setCredential('');
				setDenied(true);
				onDenied();
			}
			return false;
		} finally {
			setChecking(false);
		}
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if(busy || denied) return;
		const invalid = validate();
		if(invalid) {
			setError(invalid);
			return;
		}
		setBusy(true);
		onBusyChange?.(true);
		setError('');
		try {
			const connectionChanged =
				!server ||
				endpoint.trim() !== server.endpoint ||
				auth !== server.auth_type ||
				Boolean(credential);
			if(connectionChanged && !(await testConnection()))
				return;
			const result = await projectWrite<McpServer>(`/${projectId}/mcp-servers${server ? `/${server.id}` : ''}`, server ? 'PATCH' : 'POST', {
				name: name.trim(),
				endpoint: endpoint.trim(),
				auth_type: auth,
				...(auth === 'bearer' &&
					credential
					? { credential }
					: {}),
			});
			setCredential('');
			onSaved(result);
		} catch(error) {
			setError(
				error instanceof Error
					? error.message
					: 'Unable to save this connection.',
			);
			if(
				error instanceof ProjectRequestError &&
				[403, 404].includes(error.status)
			) {
				setCredential('');
				setDenied(true);
				onDenied();
			}
		} finally {
			setBusy(false);
			onBusyChange?.(false);
		}
	}

	return {
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
	};
}
