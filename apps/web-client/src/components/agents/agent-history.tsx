'use client';
import { configOf, type Agent, type AgentSummary } from '@/types/agent';
import { useRevisionHistory } from '@/hooks/use-revision-history';

export function AgentHistory({ base }: { base: string }) {
	const { items, hasMore, preview, loading: busy, error, view, more } = useRevisionHistory<AgentSummary, Agent>(base);

	return (
		<section>
			<h3>Revision history</h3>
			<p className='mcp-note'>
				Saved configurations are read-only. Prompt and
				tool references keep their original revisions.
			</p>
			{error && (
				<p role='alert' className='mcp-error'>
					{error}
				</p>
			)}
			<ol className='prompt-revisions'>
				{items.map(item => (
					<li key={item.revision}>
						<div>
							<strong>
								Revision{' '}
								{item.revision}{' '}
								· {item.name}
							</strong>
							<small>
								{new Date(item.created_at).toLocaleString()}{' '}
								·{' '}
								{item.tool_count}{' '}
								tools
							</small>
						</div>
						<button
							type='button'
							className='button'
							disabled={busy}
							onClick={() => void view(item.revision)}>
							View revision{' '}
							{item.revision}
						</button>
					</li>
				))}
			</ol>
			{hasMore && (
				<button
					type='button'
					className='button'
					disabled={busy}
					onClick={() => void more()}>
					Load older revisions
				</button>
			)}
			{preview && (
				<div className='agent-preview'>
					<h3>Revision {preview.revision}</h3>
					<pre>
						{JSON.stringify(configOf(preview), null, 2)}
					</pre>
					{preview.system_prompt && (
						<details>
							<summary>
								System prompt ·
								v
								{
									preview
										.system_prompt
										.revision
								}
							</summary>
							<pre>
								{
									preview
										.system_prompt
										.content
								}
							</pre>
						</details>
					)}
					{preview.agent_prompt && (
						<details>
							<summary>
								Agent prompt · v
								{
									preview
										.agent_prompt
										.revision
								}
							</summary>
							<pre>
								{
									preview
										.agent_prompt
										.content
								}
							</pre>
						</details>
					)}
				</div>
			)}
		</section>
	);
}
