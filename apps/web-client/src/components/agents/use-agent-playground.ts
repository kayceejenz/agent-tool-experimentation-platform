'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useExecutionPolling } from '@/hooks/use-execution-polling';
import { isCancelled } from '@/lib/http/response';
import { projectRequest } from '@/lib/projects/client';
import type { AgentSummary } from '@/types/agent';
import type { ExecutionOverview, ExecutionStatus, ExecutionSummary } from '@/types/execution';
import { useModalDialog } from '@/hooks/use-modal-dialog';
import { projectWrite } from '@/lib/projects/client';

export function useAgentPlayground({
	projectId,
	agent,
}: {
	projectId: string;
	agent: AgentSummary;
}) {
	const dialog = useModalDialog();
	const [input, setInput] = useState(''),
		[error, setError] = useState(''),
		[busy, setBusy] = useState(false);
	const [run, setRun] = useState<ExecutionOverview | null>(null),
		[history, setHistory] = useState<ExecutionSummary[]>([]);
	const [offset, setOffset] = useState<number | null>(null),
		[requestId, setRequestId] = useState<string | null>(null);
	const [refresh, setRefresh] = useState(0);
	const [view, setView] = useState<'run' | 'history'>('run');
	const [showDetails, setShowDetails] = useState(false);
	const [expandedTask, setExpandedTask] = useState(false);
	const [copied, setCopied] = useState(false);
	const taskInput = useRef<HTMLTextAreaElement>(null);
	const base = `/${projectId}`;
	const pending = run?.status === 'queued' || run?.status === 'running';
	useEffect(() => {
		taskInput.current?.focus();
	}, []);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timer);
	}, [copied]);
	useEffect(() => {
		let active = true;
		const controller = new AbortController();
		void projectRequest<{
			items: ExecutionSummary[];
			next_offset: number | null;
		}>(`${base}/agents/${agent.id}/executions`, { signal: controller.signal })
			.then(page => {
				if (active) {
					setHistory(page.items);
					setOffset(page.next_offset);
				}
			})
			.catch(e => {
				if (active && !isCancelled(e)) setError(e.message);
			});
		return () => {
			active = false;
			controller.abort();
		};
	}, [base, agent.id, refresh]);
	const updateStatus = useCallback((value: ExecutionStatus) => setRun(old => old && old.id === value.id ? { ...old, ...value } : old), []);
	const finished = useCallback(() => setRefresh(value => value + 1), []);
	const polling = useExecutionPolling(run ? `${base}/executions/${run.id}` : null, pending, updateStatus, finished);
	async function inspect(id: string) {
		setBusy(true);
		setError('');
		try {
			setRun(
				await projectRequest<ExecutionOverview>(
					`${base}/executions/${id}?view=summary`,
				),
			);
			setView('run');
			setShowDetails(false);
			setExpandedTask(false);
			setCopied(false);
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to load execution.',
			);
		} finally {
			setBusy(false);
		}
	}
	async function start() {
		setBusy(true);
		setError('');
		const id = requestId ?? crypto.randomUUID();
		setRequestId(id);
		try {
			const value = await projectWrite<{ id: string }>(`${base}/agents/${agent.id}/executions`, 'POST', {
				input,
				revision: agent.revision,
				request_id: id,
			});
			setRequestId(null);
			await inspect(value.id);
			setRefresh(n => n + 1);
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to start execution.',
			);
		} finally {
			setBusy(false);
		}
	}
	async function cancel() {
		if (!run) return;
		setBusy(true);
		setError('');
		try {
			setRun(
				await projectRequest<ExecutionOverview>(
					`${base}/executions/${run.id}/cancel`,
					{ method: 'POST' },
				),
			);
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to cancel execution.',
			);
		} finally {
			setBusy(false);
		}
	}
	async function more() {
		setBusy(true);
		try {
			const page = await projectRequest<{
				items: ExecutionSummary[];
				next_offset: number | null;
			}>(
				`${base}/agents/${agent.id}/executions?offset=${offset}`,
			);
			setHistory(old => [...old, ...page.items]);
			setOffset(page.next_offset);
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to load history.',
			);
		} finally {
			setBusy(false);
		}
	}
	const budgetHint = run?.termination_reason === 'tool_result_too_large'
		? 'The tool returned too much data. Narrow the query or request fewer results, then run again. The full result is available in execution details.'
		: run?.termination_reason === 'context_limit'
			? 'The conversation and tool definitions are too large. Use a smaller task or select fewer tools, then run again.' : null;
	const failureHint = budgetHint ?? run?.failure_hint;
	async function copyAnswer() {
		if (!run?.final_answer) return;
		try {
			await navigator.clipboard.writeText(run.final_answer);
			setCopied(true);
		} catch {
			setError(
				'Unable to copy. Select the answer text to copy it.',
			);
		}
	}
	function newTask() {
		setView('run');
		setRun(null);
		setInput('');
		setError('');
		setRequestId(null);
		setShowDetails(false);
		setExpandedTask(false);
		setCopied(false);
		requestAnimationFrame(() => taskInput.current?.focus());
	}
	function updateInput(value: string) { setInput(value); setRequestId(null); }
	function refreshHistory() { setRefresh(value => value + 1); }
	function editTask() {
		if (!run || pending || busy) return;
		setInput(run.input); setRun(null); setRequestId(null); setError('');
		requestAnimationFrame(() => taskInput.current?.focus());
	}

	return {
		updateInput, editTask, refreshHistory,
		dialog,
		input,
		error,
		busy,
		run,
		history,
		offset,
		view,
		setView,
		showDetails,
		setShowDetails,
		expandedTask,
		setExpandedTask,
		copied,
		taskInput,
		base,
		pending,
		polling,
		inspect,
		start,
		cancel,
		more,
		failureHint,
		copyAnswer,
		newTask,
	};
}
