'use client';
import { useEffect, useState } from 'react';
import { projectRequest } from '@/lib/projects/client';
import {
	configOf,
	type Agent,
	type AgentPage,
	type AgentSummary,
} from '@/types/agent';
export function AgentHistory({ base }: { base: string }) {
	const [items, setItems] = useState<AgentSummary[]>([]),
		[offset, setOffset] = useState<number | null>(null),
		[preview, setPreview] = useState<Agent | null>(null),
		[busy, setBusy] = useState(false),
		[error, setError] = useState('');
	useEffect(() => {
		let active = true;
		void projectRequest<AgentPage>(`${base}/revisions`)
			.then((page) => {
				if (active) {
					setItems(page.items);
					setOffset(page.next_offset);
				}
			})
			.catch((e) => {
				if (active) setError(e.message);
			});
		return () => {
			active = false;
		};
	}, [base]);
	async function view(revision: number) {
		setBusy(true);
		setError('');
		try {
			setPreview(await projectRequest<Agent>(`${base}/revisions/${revision}`));
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Unable to load revision.');
		} finally {
			setBusy(false);
		}
	}
	async function more() {
		if (offset === null) return;
		setBusy(true);
		try {
			const page = await projectRequest<AgentPage>(
				`${base}/revisions?offset=${offset}`,
			);
			setItems((old) => [...old, ...page.items]);
			setOffset(page.next_offset);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Unable to load history.');
		} finally {
			setBusy(false);
		}
	}
	return (
		<section>
			<h3>Revision history</h3>
			<p className="mcp-note">
				Saved configurations are read-only. Prompt and tool references keep
				their original revisions.
			</p>
			{error && (
				<p role="alert" className="mcp-error">
					{error}
				</p>
			)}
			<ol className="prompt-revisions">
				{items.map((item) => (
					<li key={item.revision}>
						<div>
							<strong>
								Revision {item.revision} · {item.name}
							</strong>
							<small>
								{new Date(item.created_at).toLocaleString()} · {item.tool_count}{' '}
								tools
							</small>
						</div>
						<button
							type="button"
							className="button"
							disabled={busy}
							onClick={() => void view(item.revision)}
						>
							View revision {item.revision}
						</button>
					</li>
				))}
			</ol>
			{offset !== null && (
				<button
					type="button"
					className="button"
					disabled={busy}
					onClick={() => void more()}
				>
					Load older revisions
				</button>
			)}
			{preview && (
				<div className="agent-preview">
					<h3>Revision {preview.revision}</h3>
					<pre>{JSON.stringify(configOf(preview), null, 2)}</pre>
					{preview.system_prompt && (
						<details>
							<summary>
								System prompt · v{preview.system_prompt.revision}
							</summary>
							<pre>{preview.system_prompt.content}</pre>
						</details>
					)}
					{preview.agent_prompt && (
						<details>
							<summary>Agent prompt · v{preview.agent_prompt.revision}</summary>
							<pre>{preview.agent_prompt.content}</pre>
						</details>
					)}
				</div>
			)}
		</section>
	);
}
