'use client';
import { type Prompt, type PromptSummary } from '@/types/prompt';
import { useRevisionHistory } from '@/hooks/use-revision-history';

export function PromptHistory({ base }: { base: string }) {
	const { items, hasMore, preview, loading: loading, error, view, more } = useRevisionHistory<PromptSummary, Prompt>(base);

	return (
		<section>
			<h3>Revision history</h3>
			<p className='mcp-note'>
				Saved versions are read-only. Select a revision
				to inspect its original instructions.
			</p>
			{error && (
				<p className='mcp-error' role='alert'>
					{error}
				</p>
			)}
			{loading && <p role='status'>Loading…</p>}
			<ol className='prompt-revisions'>
				{items.map(item => (
					<li key={item.revision}>
						<div>
							<strong>
								Revision{' '}
								{item.revision}
							</strong>
							<small>
								{item.name} ·{' '}
								{new Date(item.created_at).toLocaleString()}
							</small>
						</div>
						<button
							className='button'
							disabled={loading}
							aria-label={`View revision ${item.revision}`}
							onClick={() => void view(item.revision)}>
							View
						</button>
					</li>
				))}
			</ol>
			{hasMore && (
				<button
					className='button'
					disabled={loading}
					onClick={() => void more()}>
					Load older revisions
				</button>
			)}
			{preview && (
				<article className='prompt-preview'>
					<h3>
						Revision {preview.revision}:{' '}
						{preview.name}
					</h3>
					<p>{preview.description}</p>
					<pre>{preview.content}</pre>
				</article>
			)}
		</section>
	);
}
