'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, History, Plus, X } from 'lucide-react';
import { projectRequest } from '@/lib/projects/client';
import type { AgentSummary } from '@/types/agent';
import type { Execution, ExecutionSpan, ExecutionSummary } from '@/types/execution';

export function AgentPlayground({ projectId, agent, canRun, onClose }: { projectId: string; agent: AgentSummary; canRun: boolean; onClose: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [input, setInput] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
	const [run, setRun] = useState<Execution | null>(null), [history, setHistory] = useState<ExecutionSummary[]>([]);
	const [offset, setOffset] = useState<number | null>(null), [requestId, setRequestId] = useState<string | null>(null);
	const [refresh, setRefresh] = useState(0);
	const [view, setView] = useState<'run' | 'history'>('run');
	const [showDetails, setShowDetails] = useState(false);
	const taskInput = useRef<HTMLTextAreaElement>(null);
	const base = `/${projectId}`;
	const pending = run?.status === 'queued' || run?.status === 'running';
	useEffect(() => { dialog.current?.showModal(); }, []);
	useEffect(() => {
		let active = true;
		void projectRequest<{ items: ExecutionSummary[]; next_offset: number | null }>(`${base}/agents/${agent.id}/executions`)
			.then((page) => { if (active) { setHistory(page.items); setOffset(page.next_offset); } })
			.catch((e) => { if (active) setError(e.message); });
		return () => { active = false; };
	}, [base, agent.id, refresh]);
	useEffect(() => {
		if (!pending || !run) return;
		let active = true;
		const timer = setTimeout(() => {
			void projectRequest<Execution>(`${base}/executions/${run.id}`)
				.then((value) => { if (active) { setRun(value); if (!['queued', 'running'].includes(value.status)) setRefresh((n) => n + 1); } })
				.catch((e) => { if (active) { setError(e.message); setRefresh((n) => n + 1); } });
		}, 1000);
		return () => { active = false; clearTimeout(timer); };
	}, [base, run, pending, refresh]);
	async function inspect(id: string) {
		setBusy(true); setError('');
		try { setRun(await projectRequest<Execution>(`${base}/executions/${id}`)); setView('run'); setShowDetails(false); }
		catch (e) { setError(e instanceof Error ? e.message : 'Unable to load execution.'); }
		finally { setBusy(false); }
	}
	async function start() {
		setBusy(true); setError('');
		const id = requestId ?? crypto.randomUUID(); setRequestId(id);
		try {
			const value = await projectRequest<{ id: string }>(`${base}/agents/${agent.id}/executions`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ input, revision: agent.revision, request_id: id }),
			});
			setRequestId(null); await inspect(value.id); setRefresh((n) => n + 1);
		} catch (e) { setError(e instanceof Error ? e.message : 'Unable to start execution.'); }
		finally { setBusy(false); }
	}
	async function cancel() {
		if (!run) return;
		setBusy(true); setError('');
		try { setRun(await projectRequest<Execution>(`${base}/executions/${run.id}/cancel`, { method: 'POST' })); }
		catch (e) { setError(e instanceof Error ? e.message : 'Unable to cancel execution.'); }
		finally { setBusy(false); }
	}
	async function more() {
		setBusy(true);
		try {
			const page = await projectRequest<{ items: ExecutionSummary[]; next_offset: number | null }>(`${base}/agents/${agent.id}/executions?offset=${offset}`);
			setHistory((old) => [...old, ...page.items]); setOffset(page.next_offset);
		} catch (e) { setError(e instanceof Error ? e.message : 'Unable to load history.'); }
		finally { setBusy(false); }
	}
	const modelTurns = run?.spans.filter((span) => span.kind === 'model') ?? [];
	const toolCalls = run?.spans.filter((span) => span.kind === 'tool') ?? [];
	const failure = run?.spans.find((span) => span.error_code)?.outputs;
	const budgetHint = run?.termination_reason === 'tool_result_too_large' ? 'The tool returned too much data. Narrow the query or request fewer results, then run again. The full result is available in execution details.' : run?.termination_reason === 'context_limit' ? 'The conversation and tool definitions are too large. Use a smaller task or select fewer tools, then run again.' : null;
	const failureHint = budgetHint ?? (failure && typeof failure === 'object' && 'hint' in failure && typeof failure.hint === 'string' ? failure.hint : null);
	function newTask() {
		setView('run'); setRun(null); setInput(''); setError(''); setRequestId(null); setShowDetails(false);
		requestAnimationFrame(() => taskInput.current?.focus());
	}
	return <dialog ref={dialog} className="mcp-sheet agent-create-dialog execution-dialog" aria-labelledby="playground-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
		<header className="mcp-sheet-header">
			<div><p className="eyebrow">Playground</p><h2 id="playground-title">{agent.name}</h2><p className="playground-subtitle">{agent.model_settings.model || 'Model not configured'}</p></div>
			<div className="playground-header-actions">
				<button className="button playground-secondary" aria-pressed={view === 'history'} onClick={() => setView(view === 'history' ? 'run' : 'history')}><History size={16} aria-hidden="true" />History</button>
				{run && <button className="button playground-secondary" disabled={busy || pending} onClick={newTask}><Plus size={16} aria-hidden="true" />New task</button>}
				<button className="playground-close" aria-label="Close" onClick={onClose}><X size={20} aria-hidden="true" /></button>
			</div>
		</header>
		<div className="mcp-sheet-body playground-body">
			{error && <p role="alert" className="playground-feedback mcp-error">{error}</p>}
			{view === 'history' ? <section className="playground-history" aria-label="Execution history">
				<button className="playground-back" onClick={() => setView('run')}><ArrowLeft size={16} aria-hidden="true" />Back to playground</button>
				<div className="playground-section-heading"><h3>Recent tasks</h3><button className="button" disabled={busy} onClick={() => setRefresh((n) => n + 1)}>Refresh</button></div>
				{!history.length && <div className="playground-empty"><h4>No tasks yet</h4><p>Run your first task to see it here.</p></div>}
				<ul className="execution-history">{history.map((item) => <li key={item.id}><button disabled={busy} onClick={() => void inspect(item.id)} aria-pressed={run?.id === item.id}><span className="history-task">{item.input}</span><span className={`execution-status status-${item.status}`}>{item.status}</span><small>{new Date(item.created_at).toLocaleString()}</small></button></li>)}</ul>
				{offset !== null && <button className="button" disabled={busy} onClick={() => void more()}>Load more</button>}
			</section> : !run ? <section className="playground-composer" aria-label="Run agent">
				<div className="playground-intro"><h3>What would you like to try?</h3><p>Give the agent a task. See its answer and how it got there.</p></div>
				<form onSubmit={(e) => { e.preventDefault(); void start(); }}>
					<label htmlFor="playground-task" className="playground-task-label">Your task</label>
					<div className="playground-input-box"><textarea id="playground-task" aria-label="Task" ref={taskInput} value={input} rows={5} placeholder="Find three keyboards under £50 and check their stock…" maxLength={16000} disabled={busy || !canRun} onChange={(e) => { setInput(e.target.value); setRequestId(null); }} />
						<div className="execution-actions"><span>Be specific about the result you want.</span><button className="button primary" disabled={busy || !canRun || !agent.enabled || !input.trim()}>{busy ? 'Starting…' : 'Run task'}<ArrowUp size={16} aria-hidden="true" /></button></div>
					</div>
					{!canRun && <p className="mcp-note">You have read-only access. Open History to inspect saved tasks.</p>}
					{canRun && !agent.enabled && <p className="mcp-note">Enable this agent in Manage to run a task.</p>}
				</form>
			</section> : <section className="playground-results" aria-label="Execution stack" key={run.id}>
				<div className="playground-task-message"><span className="playground-message-label">Your task</span><p>{run.input}</p>{!pending && canRun && <button className="playground-text-button" disabled={busy} onClick={() => { setInput(run.input); setRun(null); setRequestId(null); setError(''); requestAnimationFrame(() => taskInput.current?.focus()); }}>Edit and run again</button>}</div>
				<div className="playground-run-heading"><h3>Answer</h3><div className="playground-run-actions"><span role="status" className={`execution-status status-${run.status}`}>{run.status}</span>{pending && canRun && <button className="button" disabled={busy} onClick={() => void cancel()}>Stop</button>}</div></div>
				{run.final_answer ? <div className="execution-answer"><p>{run.final_answer}</p></div> : pending ? <div className="playground-working"><span className="playground-progress" aria-hidden="true" /><div><p>{run.status === 'queued' ? 'Waiting to start…' : 'Working on your task…'}</p><small>You can close this window. Your task will keep running.</small></div></div> : <div className="playground-outcome"><h4>{run.status === 'failed' ? 'The task could not finish' : run.status === 'cancelled' ? 'Task stopped' : 'No answer returned'}</h4><p>{failureHint ?? 'Open execution details below to see where the task stopped.'}</p>{run.termination_reason && <span className="playground-reason">{run.termination_reason.replaceAll('_', ' ')}</span>}</div>}
				<details className="playground-details" open={showDetails} onToggle={(e) => setShowDetails(e.currentTarget.open)}>
					<summary>Execution details <span>{toolCalls.length} tool {toolCalls.length === 1 ? 'call' : 'calls'} · {modelTurns.length} model {modelTurns.length === 1 ? 'turn' : 'turns'}</span></summary>
					{showDetails && <div className="playground-detail-content"><p className="playground-trace-note">Open a step to see what the agent sent and received.</p>{!modelTurns.length && <p className="mcp-note">No steps recorded yet.</p>}{modelTurns.map((span) => <div key={span.id} className="execution-turn"><SpanDetails span={span} spans={run.spans} /><div className="execution-children">{run.spans.filter((child) => child.parent_id === span.id).map((child) => <SpanDetails key={child.id} span={child} spans={run.spans} />)}</div></div>)}
						<details className="playground-configuration"><summary>Run settings</summary><pre>{JSON.stringify(run.snapshot, null, 2)}</pre></details>
					</div>}
				</details>
			</section>}
		</div>
	</dialog>;
}

function SpanDetails({ span, spans }: { span: ExecutionSpan; spans: ExecutionSpan[] }) {
	return <details className="execution-span" id={`span-${span.id}`}>
		<summary><span className={`trace-step-number trace-${span.kind}`}>{span.sequence}</span><strong>{span.name}</strong><span className={`execution-status status-${span.status}`}>{span.status}</span>{span.duration_ms !== null && <small>{span.duration_ms} ms</small>}</summary>
		<div className="trace-step-content">
			{span.context_span_ids.length > 0 && <div className="trace-context"><span>Earlier results in context</span>{span.context_span_ids.map((id) => { const source = spans.find((item) => item.id === id); return <a key={id} href={`#span-${id}`} onClick={() => { const target = document.getElementById(`span-${id}`); if (target instanceof HTMLDetailsElement) target.open = true; }}>{source ? `#${source.sequence} ${source.name}` : id}</a>; })}</div>}
			{span.error_code && <p className="playground-feedback mcp-error">{span.error_code.replaceAll('_', ' ')}</p>}
			<div className="trace-payloads"><div><h4>Inputs</h4><pre>{JSON.stringify(span.inputs, null, 2)}</pre></div><div><h4>Outputs</h4><pre>{JSON.stringify(span.outputs, null, 2)}</pre></div></div>
			<details className="trace-identifiers"><summary>Lineage details</summary><dl><dt>Span</dt><dd>{span.id}</dd>{span.call_id && <><dt>Call</dt><dd>{span.call_id}</dd></>}{span.tool_revision && <><dt>Tool revision</dt><dd>{span.tool_revision}</dd></>}{span.tool_execution_id && <><dt>Executor record</dt><dd>{span.tool_execution_id}</dd></>}</dl></details>
		</div>
	</details>;
}
