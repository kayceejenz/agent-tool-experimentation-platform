'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePagedCatalog } from '@/hooks/use-paged-catalog';
import { projectRequest } from '@/lib/projects/client';
import { isCancelled } from '@/lib/http/response';
import type { ExecutionSpan, SpanSummary } from '@/types/execution';

export function ExecutionTrace({ path, version }: { path: string; version: string }) {
	const catalog = usePagedCatalog<SpanSummary>(`${path}/spans?version=${encodeURIComponent(version)}`);
	const index = useMemo(() => {
		const byId = new Map(catalog.items.map(span => [span.id, span]));
		const children = new Map<string, SpanSummary[]>();
		for(const span of catalog.items) if(span.parent_id) {
			const group = children.get(span.parent_id) ?? []; group.push(span); children.set(span.parent_id, group);
		}
		return { byId, children };
	}, [catalog.items]);
	return <div className='playground-detail-content'>
		<p className='playground-trace-note'>Open a step to load what the agent sent and received.</p>
		{catalog.error && <p role='alert'>{catalog.error}</p>}
		{catalog.loading && <p role='status'>Loading execution steps…</p>}
		{!catalog.loading && !catalog.items.length && <p>No steps recorded yet.</p>}
		{catalog.items.filter(span => !span.parent_id || !index.byId.has(span.parent_id)).map(span => <div className='execution-turn' key={span.id}>
			<SpanDetails span={span} path={path} byId={index.byId} />
			<div className='execution-children'>{(index.children.get(span.id) ?? []).map(child => <SpanDetails key={child.id} span={child} path={path} byId={index.byId} />)}</div>
		</div>)}
		{catalog.hasMore && <button type='button' className='button' disabled={catalog.loading} onClick={() => void catalog.more()}>Load more execution steps</button>}
		<Snapshot path={path} />
	</div>;
}


function SpanDetails({ span, path, byId }: { span: SpanSummary; path: string; byId: Map<string, SpanSummary> }) {
	const [open, setOpen] = useState(false);
	const [payload, setPayload] = useState<ExecutionSpan | null>(null);
	const [error, setError] = useState('');
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		if(!open) return;
		const controller = new AbortController();
		void projectRequest<ExecutionSpan>(`${path}/spans/${span.id}`, { signal: controller.signal })
			.then(value => { setPayload(value); setError(''); })
			.catch(error => { if(!isCancelled(error)) setError(error.message); });
		return () => controller.abort();
	}, [open, path, span.id, span.status, span.duration_ms, attempt]);
	return <details className='execution-span' id={`span-${span.id}`} onToggle={event => setOpen(event.currentTarget.open)}>
		<summary><span className={`trace-step-number trace-${span.kind}`}>{span.sequence}</span><strong>{span.name}</strong>
			<span className={`execution-status status-${span.status}`}>{span.status}</span>
			{span.duration_ms !== null && <small>{span.duration_ms} ms</small>}
		</summary>
		{open && <div className='trace-step-content'>
			{span.context_span_ids.length > 0 && <div className='trace-context'><span>Earlier results in context</span>
				{span.context_span_ids.map(id => <a key={id} href={`#span-${id}`} onClick={() => {
					const target = document.getElementById(`span-${id}`);
					if(target instanceof HTMLDetailsElement) target.open = true;
				}}>{byId.has(id) ? `#${byId.get(id)!.sequence} ${byId.get(id)!.name}` : id}</a>)}
			</div>}
			{span.error_code && <p className='playground-feedback mcp-error'>{span.error_code.replaceAll('_', ' ')}</p>}
			{error ? <div role='alert'>{error}<button type='button' className='button' onClick={() => setAttempt(value => value + 1)}>Retry step</button></div>
				: payload ? <div className='trace-payloads'><div><h4>Inputs</h4><pre>{JSON.stringify(payload.inputs, null, 2)}</pre></div>
					<div><h4>Outputs</h4><pre>{JSON.stringify(payload.outputs, null, 2)}</pre></div></div> : <p role='status'>Loading step payload…</p>}
			<details className='trace-identifiers'><summary>Lineage details</summary><dl><dt>Span</dt><dd>{span.id}</dd>
				{span.call_id && <><dt>Call</dt><dd>{span.call_id}</dd></>}
				{span.tool_revision && <><dt>Tool revision</dt><dd>{span.tool_revision}</dd></>}
				{span.tool_execution_id && <><dt>Executor record</dt><dd>{span.tool_execution_id}</dd></>}
			</dl></details>
		</div>}
	</details>;
}


function Snapshot({ path }: { path: string }) {
	const [open, setOpen] = useState(false);
	const [snapshot, setSnapshot] = useState<unknown>(null);
	const [error, setError] = useState('');
	useEffect(() => {
		if(!open) return;
		const controller = new AbortController();
		void projectRequest<{ snapshot: unknown }>(`${path}/snapshot`, { signal: controller.signal })
			.then(value => { setSnapshot(value.snapshot); setError(''); }).catch(error => { if(!isCancelled(error)) setError(error.message); });
		return () => controller.abort();
	}, [path, open]);
	return <details className='playground-configuration' onToggle={event => setOpen(event.currentTarget.open)}><summary>Run settings</summary>
		{open && (error ? <p role='alert'>{error}</p> : snapshot ? <pre>{JSON.stringify(snapshot, null, 2)}</pre> : <p role='status'>Loading settings…</p>)}
	</details>;
}
