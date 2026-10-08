'use client';
import type { ToolPage } from '@/types/tool';
import { useEffect, useRef, useState } from 'react';
import type { McpServer } from '@/types/mcp-server';
import { projectRequest, ProjectRequestError } from '@/lib/projects/client';
import { checkErrors } from './check-errors';
import { useModalDialog } from '@/hooks/use-modal-dialog';

export type DiscoveredTool = {
	name: string;
	description: string | null;
	input_schema: Record<string, unknown>;
};

type ProbeResult = {
	server: McpServer;
	tools: DiscoveredTool[] | null;
};

type Props = {
	server: McpServer;
	projectId: string;
	canManage: boolean;
	onClose: () => void;
	onUpdated: (server: McpServer) => void;
	onDenied: () => void;
};

export function useManageServer({
	server: initial,
	projectId,
	canManage,
	onClose,
	onUpdated,
	onDenied,
}: Props) {
	const dialog = useModalDialog();
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
		let active = true;
		void projectRequest<ToolPage>(
			`/${projectId}/tools?server_id=${initial.id}`,
		)
			.then(page => {
				if(active)
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
				if(active)
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
		if(
			error instanceof ProjectRequestError &&
			[403, 404].includes(error.status)
		) {
			setDenied(true);
			onDenied();
		}
	}

	async function check() {
		if(busy || !editable) return;
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

			if(result.server.connection_status === 'error') {
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
		} catch(error) {
			fail(error, 'Unable to check this connection.');
		} finally {
			setOperation(null);
		}
	}

	async function discover() {
		if(busy || !editable) return;
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
			if(result.tools !== null) setTools(result.tools);
			if(result.server.connection_status === 'error') {
				setError(
					checkErrors[
					result.server.last_error_code ??
					''
					] ??
					'Unable to reach this MCP server. Verify the endpoint and try again.',
				);
			} else {
				setNotice(
					`${result.tools?.length ?? 0} ${result.tools?.length === 1
						? 'tool'
						: 'tools'
					} discovered.`,
				);
			}
		} catch(error) {
			fail(error, 'Unable to discover tools.');
		} finally {
			setOperation(null);
		}
	}

	async function toggle() {
		if(busy || !editable) return;
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
				`${updated.name} ${updated.enabled ? 'enabled' : 'disabled'
				}.`,
			);
		} catch(error) {
			fail(error, 'Unable to change availability.');
		} finally {
			setOperation(null);
		}
	}

	function dismiss() {
		if(busy) return;
		if(editing) {
			setEditing(false);
			requestAnimationFrame(() =>
				editButton.current?.focus(),
			);
			return;
		}
		onClose();
	}

	return {
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
	};
}
