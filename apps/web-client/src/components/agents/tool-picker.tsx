'use client';
import { useEffect, useState } from 'react';
import { projectRequest } from '@/lib/projects/client';
import type { Tool, ToolPage } from '@/types/tool';
import type { ToolBinding } from '@/types/agent';
export function ToolPicker({
	projectId,
	value,
	disabled,
	onChange,
}: {
	projectId: string;
	value: ToolBinding[];
	disabled: boolean;
	onChange: (tools: ToolBinding[]) => void;
}) {
	const [tools, setTools] = useState<Tool[]>([]),
		[error, setError] = useState(''),
		[loading, setLoading] = useState(true);
	useEffect(() => {
		let active = true;
		async function load() {
			let offset: number | null = 0;
			const items: Tool[] = [];
			do {
				const page: ToolPage = await projectRequest(
					`/${projectId}/tools?offset=${offset}`,
				);
				items.push(...page.items);
				offset = page.next_offset;
			} while (offset !== null && active);
			return items;
		}
		void load()
			.then((items) => {
				if (active) setTools(items);
			})
			.catch((e) => {
				if (active) setError(e.message);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [projectId]);
	function binding(tool: Tool): ToolBinding {
		return {
			id: tool.id,
			revision: tool.revision,
			latest_revision: tool.revision,
			name: tool.name,
			server_id: tool.server_id,
			server_name: tool.server_name,
			enabled: tool.enabled,
			available: tool.available,
			server_enabled: tool.server_enabled,
		};
	}
	const servers = [...new Set(tools.map((t) => t.server_id))];
	return (
		<section>
			<h3>Allowed tools</h3>
			<p className="mcp-note">
				Select individual tools. Disabled connections or tools must be enabled
				on their own pages. Selecting a tool does not enable it.
			</p>
			{error && (
				<p className="mcp-error" role="alert">
					{error}
				</p>
			)}
			{loading ? (
				<p role="status">Loading tools…</p>
			) : !tools.length ? (
				<p>
					No tools discovered. Add an MCP server and discover its tools first.
				</p>
			) : (
				servers.map((server) => (
					<fieldset className="agent-tools" key={server} disabled={disabled}>
						<legend>
							{tools.find((t) => t.server_id === server)?.server_name}
						</legend>
						{tools
							.filter((t) => t.server_id === server)
							.map((tool) => {
								const selected = value.find((t) => t.id === tool.id);
								return (
									<div className="agent-tool" key={tool.id}>
										<label>
											<input
												type="checkbox"
												checked={!!selected}
												disabled={!selected && value.length >= 200}
												onChange={(e) =>
													onChange(
														e.target.checked
															? [...value, binding(tool)]
															: value.filter((t) => t.id !== tool.id),
													)
												}
											/>
											<span>
												<strong>{tool.name}</strong>
												<small>{tool.definition.description}</small>
												<small>
													{tool.available
														? tool.enabled && tool.server_enabled
															? 'Available'
															: 'Tool or connection disabled'
														: 'Rediscovery required'}{' '}
													· Revision {selected?.revision ?? tool.revision}
												</small>
											</span>
										</label>
										{selected && selected.revision !== tool.revision && (
											<div>
												<p className="mcp-error">
													Selected definition changed.
												</p>
												<details className="agent-preview">
													<summary>Review latest definition</summary>
													<pre>{JSON.stringify(tool.definition, null, 2)}</pre>
												</details>
												<button
													type="button"
													className="button"
													onClick={() =>
														onChange(
															value.map((t) =>
																t.id === tool.id ? binding(tool) : t,
															),
														)
													}
												>
													Use revision {tool.revision}
												</button>
											</div>
										)}
									</div>
								);
							})}
					</fieldset>
				))
			)}
			{value
				.filter((t) => !tools.some((item) => item.id === t.id))
				.map((tool) => (
					<div key={tool.id} className="agent-tool">
						<p>
							{tool.server_name} / {tool.name} · Selected revision{' '}
							{tool.revision}
						</p>
						<button
							type="button"
							className="button"
							disabled={disabled || loading}
							onClick={() => onChange(value.filter((t) => t.id !== tool.id))}
						>
							Remove selection
						</button>
					</div>
				))}
		</section>
	);
}
