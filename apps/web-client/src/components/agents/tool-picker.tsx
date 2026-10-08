'use client';
import { useEffect, useMemo, useState } from 'react';
import { useDebouncedValue, usePagedCatalog } from '@/hooks/use-paged-catalog';
import { projectRequest } from '@/lib/projects/client';
import { isCancelled } from '@/lib/http/response';
import type { Tool, ToolSummary } from '@/types/tool';
import type { ToolBinding } from '@/types/agent';

export function ToolPicker({ projectId, value, disabled, onChange }: {
	projectId: string; value: ToolBinding[]; disabled: boolean; onChange: (tools: ToolBinding[]) => void;
}) {
	const [search, setSearch] = useState('');
	const query = useDebouncedValue(search);
	const catalog = usePagedCatalog<ToolSummary>(`/${projectId}/tools?summary=true&q=${encodeURIComponent(query)}`);
	const groups = useMemo(() => {
		const result = new Map<string, ToolSummary[]>();
		for(const tool of catalog.items) { const group = result.get(tool.server_id) ?? []; group.push(tool); result.set(tool.server_id, group); }
		return result;
	}, [catalog.items]);
	const selected = new Map(value.map(tool => [tool.id, tool]));
	const visible = new Set(catalog.items.map(tool => tool.id));
	function binding(tool: ToolSummary): ToolBinding {
		return {
			id: tool.id, revision: tool.revision, latest_revision: tool.revision, name: tool.name,
			server_id: tool.server_id, server_name: tool.server_name, enabled: tool.enabled,
			available: tool.available, server_enabled: tool.server_enabled
		};
	}
	return <section>
		<h3>Allowed tools</h3>
		<p className='mcp-note'>Select individual tools. Selecting a tool does not enable it. Selections are retained across searches and pages.</p>
		<label className='tool-field'>Search tools<input type='search' value={search} maxLength={160} onChange={e => setSearch(e.target.value)} /></label>
		{catalog.error && <p className='mcp-error' role='alert'>{catalog.error}</p>}
		{catalog.loading && <p role='status'>Loading tools…</p>}
		{!catalog.loading && !catalog.items.length && <p>No matching tools. Discover tools from an MCP server or change the search.</p>}
		{[...groups].map(([server, tools]) => <fieldset className='agent-tools' key={server} disabled={disabled}>
			<legend>{tools[0].server_name}</legend>
			{tools.map(tool => {
				const chosen = selected.get(tool.id);
				return <div className='agent-tool' key={tool.id}>
					<label><input type='checkbox' checked={!!chosen} disabled={!chosen && value.length >= 200}
						onChange={e => onChange(e.target.checked ? [...value, binding(tool)] : value.filter(item => item.id !== tool.id))} />
						<span><strong>{tool.name}</strong><small>{tool.description}</small><small>
							{tool.available ? tool.enabled && tool.server_enabled ? 'Available' : 'Tool or connection disabled' : 'Rediscovery required'} · Revision {chosen?.revision ?? tool.revision}
						</small></span>
					</label>
					{chosen && chosen.revision !== tool.revision && <div>
						<p className='mcp-error'>Selected definition changed.</p>
						<ToolDefinition projectId={projectId} toolId={tool.id} />
						<button type='button' className='button' onClick={() => onChange(value.map(item => item.id === tool.id ? binding(tool) : item))}>Use revision {tool.revision}</button>
					</div>}
				</div>;
			})}
		</fieldset>)}
		{catalog.hasMore && <button type='button' className='button' disabled={catalog.loading} onClick={() => void catalog.more()}>Load more tools</button>}
		{value.filter(tool => !visible.has(tool.id)).map(tool => <div key={tool.id} className='agent-tool'>
			<p>{tool.server_name} / {tool.name} · Selected revision {tool.revision}</p>
			<button type='button' className='button' disabled={disabled} onClick={() => onChange(value.filter(item => item.id !== tool.id))}>Remove selection</button>
		</div>)}
	</section>;
}


function ToolDefinition({ projectId, toolId }: { projectId: string; toolId: string }) {
	const [open, setOpen] = useState(false);
	const [tool, setTool] = useState<Tool | null>(null);
	const [error, setError] = useState('');
	useEffect(() => {
		if(!open) return;
		const controller = new AbortController();
		void projectRequest<Tool>(`/${projectId}/tools/${toolId}`, { signal: controller.signal })
			.then(value => { setTool(value); setError(''); }).catch(error => { if(!isCancelled(error)) setError(error.message); });
		return () => controller.abort();
	}, [projectId, toolId, open]);
	return <details className='agent-preview' onToggle={e => setOpen(e.currentTarget.open)}>
		<summary>Review latest definition</summary>
		{open && (error ? <p role='alert'>{error}</p> : tool ? <pre>{JSON.stringify(tool.definition, null, 2)}</pre> : <p role='status'>Loading definition…</p>)}
	</details>;
}
