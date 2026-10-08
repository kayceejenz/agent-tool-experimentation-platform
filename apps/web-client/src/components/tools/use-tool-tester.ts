'use client';
import { useCallback, useEffect, useState } from 'react';
import { useProjects } from '@/components/projects/project-provider';
import {
	clearOperation,
	operationKey,
	pendingOperation,
	reserveOperation,
} from '@/lib/tools/operation';
import { isCancelled } from '@/lib/http/response';
import type { Schema, Tool, ToolExecution } from '@/types/tool';
import { projectRequest, ProjectRequestError } from '@/lib/projects/client';
import { useModalDialog } from '@/hooks/use-modal-dialog';
import { projectWrite } from '@/lib/projects/client';

function initialInputs(schema: Schema) {
	return Object.fromEntries(
		Object.entries(schema.properties ?? {})
			.filter(([, s]) => s.default !== undefined)
			.map(([key, s]) => [key, s.default]),
	);
}

export function useToolTester({
	projectId,
	tool,
	canManage,
}: {
	projectId: string;
	tool: Tool;
	canManage: boolean;
}) {
	const dialog = useModalDialog();
	const { userId } = useProjects();
	const recoveryKey = operationKey(userId, projectId, tool.id);
	const [operationId, setOperationId] = useState<string | null>(null);
	const [recovering, setRecovering] = useState(true);
	const [mode, setMode] = useState<'form' | 'json'>('form');
	const [raw, setRaw] = useState(() =>
		JSON.stringify(
			initialInputs(tool.definition.input_schema),
			null,
			2,
		),
	);
	const [history, setHistory] = useState<ToolExecution[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [result, setResult] = useState<ToolExecution | null>(null);
	const [acknowledged, setAcknowledged] = useState(false);
	const [uncertain, setUncertain] = useState(false);
	const [invalidFields, setInvalidFields] = useState<
		Record<string, boolean>
	>({});
	const base = `/${projectId}/tools/${tool.id}/executions`;
	const schema = tool.definition.input_schema;
	useEffect(() => {
		let active = true;
		const controller = new AbortController();
		void projectRequest<{ items: ToolExecution[] }>(base, {
			signal: controller.signal,
		})
			.then(page => {
				if (active) setHistory(page.items);
			})
			.catch(e => {
				if (active && !isCancelled(e))
					setError(e.message);
			});
		return () => {
			active = false;
			controller.abort();
		};
	}, [base]);

	const reconcile = useCallback(
		async (signal?: AbortSignal) => {
			setRecovering(true);
			setError('');
			try {
				const id = pendingOperation(recoveryKey);
				setOperationId(id);
				if (id) {
					setUncertain(true);
					const saved =
						await projectRequest<ToolExecution>(
							`${base}/requests/${id}`,
							{ signal },
						);
					setResult(saved);
					if (
						[
							'success',
							'tool_error',
						].includes(saved.status)
					) {
						clearOperation(recoveryKey);
						setOperationId(null);
						setUncertain(false);
					}
				}
			} catch (error) {
				if (!isCancelled(error)) {
					setUncertain(true);
					setError(
						error instanceof
							ProjectRequestError &&
							error.status === 404
							? 'The saved operation is not recorded yet. Recheck it or verify the remote outcome before starting a new test.'
							: error instanceof Error
								? error.message
								: 'Unable to recover this operation.',
					);
				}
			} finally {
				if (!signal?.aborted) setRecovering(false);
			}
		},
		[base, recoveryKey],
	);
	useEffect(() => {
		const controller = new AbortController();
		void Promise.resolve().then(() => {
			if (!controller.signal.aborted)
				return reconcile(controller.signal);
		});
		return () => controller.abort();
	}, [reconcile]);
	let inputs: Record<string, unknown> = {};
	let valid = true;
	try {
		inputs = JSON.parse(raw);
		if (
			!inputs ||
			typeof inputs !== 'object' ||
			Array.isArray(inputs)
		)
			valid = false;
	} catch {
		valid = false;
	}

	function update(key: string, value: unknown) {
		const next = { ...inputs };
		if (value === undefined) delete next[key];
		else next[key] = value;
		setRaw(JSON.stringify(next, null, 2));
	}

	async function refreshHistory() {
		try {
			const page = await projectRequest<{
				items: ToolExecution[];
			}>(base);
			setHistory(page.items);
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to load history.',
			);
		}
	}

	async function run() {
		if (
			!valid ||
			busy ||
			recovering ||
			uncertain ||
			!canManage ||
			!acknowledged
		)
			return;
		setBusy(true);
		setError('');
		let reserved = false;
		try {
			const id = reserveOperation(recoveryKey);
			reserved = true;
			setOperationId(id);
			const response = await projectWrite<ToolExecution>(
				base,
				'POST',
				{
					arguments: inputs,
					revision: tool.revision,
					request_id: id,
				},
			);

			setResult(response);
			if (
				['success', 'tool_error'].includes(
					response.status,
				)
			) {
				clearOperation(recoveryKey);
				setOperationId(null);
			}

			setUncertain(
				response.status === 'unknown' ||
					response.status === 'running',
			);

			await refreshHistory();
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to run tool.',
			);

			const unknown =
				!(e instanceof ProjectRequestError) ||
				e.status >= 500 ||
				e.status === 408;

			setUncertain(unknown);

			if (reserved && !unknown) {
				clearOperation(recoveryKey);
				setOperationId(null);
			}

			await refreshHistory();
		} finally {
			setBusy(false);
		}
	}
	function acknowledgeOutcome() {
		if (busy || recovering) return;
		try {
			clearOperation(recoveryKey);
			setOperationId(null);
		} catch {
			setError('Unable to clear the saved operation.');
			return;
		}
		setUncertain(false);
		setAcknowledged(false);
	}

	return {
		dialog,
		operationId,
		recovering,
		mode,
		setMode,
		raw,
		setRaw,
		history,
		busy,
		error,
		result,
		acknowledged,
		setAcknowledged,
		uncertain,
		invalidFields,
		setInvalidFields,
		schema,
		reconcile,
		acknowledgeOutcome,
		inputs,
		valid,
		update,
		refreshHistory,
		run,
	};
}
