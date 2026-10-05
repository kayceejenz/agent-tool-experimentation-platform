'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { projectRequest, ProjectRequestError } from '@/lib/projects/client';
import {
	promptTypes,
	type Prompt,
	type PromptPage,
	type PromptSummary,
	type PromptType,
} from '@/types/prompt';

type Props = {
	projectId: string;
	initial: PromptSummary | null;
	canEdit: boolean;
	onClose: () => void;
	onSaved: () => void;
};
export function PromptEditor({
	projectId,
	initial,
	canEdit,
	onClose,
	onSaved,
}: Props) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [current, setCurrent] = useState<Prompt | null>(null),
		[name, setName] = useState(''),
		[description, setDescription] = useState(''),
		[content, setContent] = useState(''),
		[type, setType] = useState<PromptType>('system');
	const [loading, setLoading] = useState(!!initial),
		[busy, setBusy] = useState(false),
		[error, setError] = useState(''),
		[notice, setNotice] = useState(''),
		[denied, setDenied] = useState(false),
		[discard, setDiscard] = useState(false),
		[tab, setTab] = useState<'edit' | 'history'>('edit');
	const base = `/${projectId}/prompts`;
	const dirty = current
		? name !== current.name ||
			description !== current.description ||
			content !== current.content
		: !!(name || description || content);
	const editable =
		canEdit && !denied && !loading && (!initial || !!current);
	function apply(prompt: Prompt) {
		setCurrent(prompt);
		setName(prompt.name);
		setDescription(prompt.description);
		setContent(prompt.content);
		setType(prompt.type);
	}
	useEffect(() => {
		const element = dialog.current,
			overflow = document.body.style.overflow;
		element?.showModal();
		document.body.style.overflow = 'hidden';
		return () => {
			element?.close();
			document.body.style.overflow = overflow;
		};
	}, []);
	useEffect(() => {
		if (!initial) return;
		let active = true;
		void projectRequest<Prompt>(`${base}/${initial.id}`)
			.then(prompt => {
				if (active) apply(prompt);
			})
			.catch(e => {
				if (active) setError(e.message);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [base, initial]);
	useEffect(() => {
		if (!dirty) return;
		function prevent(event: BeforeUnloadEvent) {
			event.preventDefault();
		}
		window.addEventListener('beforeunload', prevent);
		return () =>
			window.removeEventListener('beforeunload', prevent);
	}, [dirty]);
	function close() {
		if (busy) return;
		if (dirty) {
			setDiscard(true);
			return;
		}
		onClose();
	}
	async function save(event: FormEvent) {
		event.preventDefault();
		if (!editable || busy) return;
		setBusy(true);
		setError('');
		setNotice('');
		try {
			const prompt = await projectRequest<Prompt>(
				current
					? `${base}/${current.id}/revisions`
					: base,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						name,
						description,
						content,
						...(current
							? {
									base_revision:
										current.revision,
								}
							: { type }),
					}),
				},
			);
			apply(prompt);
			setNotice(`Revision ${prompt.revision} saved.`);
			onSaved();
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to save prompt.',
			);
			if (
				e instanceof ProjectRequestError &&
				[403, 404].includes(e.status)
			)
				setDenied(true);
		} finally {
			setBusy(false);
		}
	}
	return (
		<dialog
			ref={dialog}
			className='mcp-sheet prompt-sheet'
			aria-labelledby='prompt-title'
			onCancel={e => {
				e.preventDefault();
				close();
			}}>
			<header className='mcp-sheet-header'>
				<div>
					<p className='eyebrow'>
						{current
							? `${promptTypes[current.type].label} · Revision ${current.revision}`
							: 'Prompt library'}
					</p>
					<h2 id='prompt-title'>
						{current?.name ??
							(initial
								? 'Manage prompt'
								: 'Create prompt')}
					</h2>
				</div>
				<button
					className='button'
					disabled={busy}
					onClick={close}>
					Close
				</button>
			</header>
			<div className='mcp-sheet-body'>
				{discard && (
					<div
						className='prompt-discard'
						role='alert'>
						<p>You have unsaved changes.</p>
						<div className='mcp-header-actions'>
							<button
								className='button'
								onClick={() =>
									setDiscard(
										false,
									)
								}>
								Keep editing
							</button>
							<button
								className='button'
								onClick={
									onClose
								}>
								Discard changes
							</button>
						</div>
					</div>
				)}
				{error && (
					<p className='mcp-error' role='alert'>
						{error}
					</p>
				)}
				{notice && <p role='status'>{notice}</p>}
				{current && (
					<div
						className='prompt-tabs'
						role='group'
						aria-label='Prompt views'>
						<button
							className='button'
							aria-pressed={
								tab === 'edit'
							}
							onClick={() =>
								setTab('edit')
							}>
							Current revision
						</button>
						<button
							className='button'
							aria-pressed={
								tab ===
								'history'
							}
							onClick={() =>
								setTab(
									'history',
								)
							}>
							Revision history
						</button>
					</div>
				)}
				{loading ? (
					<p role='status'>Loading prompt…</p>
				) : tab === 'history' && current ? (
					<PromptHistory
						key={`${current.id}-${current.revision}`}
						base={`${base}/${current.id}`}
					/>
				) : (
					<form onSubmit={save}>
						{!canEdit && (
							<p className='mcp-note'>
								You have
								read-only access
								to this prompt.
							</p>
						)}
						<label className='tool-field'>
							Name
							<input
								autoFocus={
									!initial
								}
								required
								maxLength={160}
								value={name}
								disabled={
									!editable ||
									busy
								}
								onChange={e =>
									setName(
										e
											.target
											.value,
									)
								}
							/>
						</label>
						<label className='tool-field'>
							Type
							<select
								value={type}
								disabled={
									!!current ||
									!editable ||
									busy
								}
								onChange={e =>
									setType(
										e
											.target
											.value as PromptType,
									)
								}>
								{Object.entries(
									promptTypes,
								).map(
									([
										key,
										item,
									]) => (
										<option
											key={
												key
											}
											value={
												key
											}>
											{
												item.label
											}
										</option>
									),
								)}
							</select>
							<small>
								{
									promptTypes[
										type
									]
										.description
								}
								{current
									? ' The type is fixed for this prompt.'
									: ''}
							</small>
						</label>
						<label className='tool-field'>
							Description{' '}
							<span className='mcp-meta'>
								(optional)
							</span>
							<textarea
								rows={2}
								maxLength={2000}
								value={
									description
								}
								disabled={
									!editable ||
									busy
								}
								onChange={e =>
									setDescription(
										e
											.target
											.value,
									)
								}
							/>
						</label>
						<label className='tool-field'>
							Instructions
							<textarea
								className='prompt-content'
								required
								rows={15}
								maxLength={
									32000
								}
								value={content}
								disabled={
									!editable ||
									busy
								}
								spellCheck={
									false
								}
								onChange={e =>
									setContent(
										e
											.target
											.value,
									)
								}
							/>
							<small>
								{content.length.toLocaleString()}{' '}
								/ 32,000
								characters
							</small>
						</label>
						<p className='mcp-note'>
							Saving creates an
							immutable revision.
							Existing configurations
							will keep their selected
							revision.
						</p>
						{canEdit && (
							<button
								className='button primary'
								type='submit'
								disabled={
									!editable ||
									busy ||
									!dirty ||
									!name.trim() ||
									!content.trim()
								}>
								{busy
									? 'Saving…'
									: current
										? 'Save new revision'
										: 'Create prompt'}
							</button>
						)}
					</form>
				)}
			</div>
		</dialog>
	);
}
function PromptHistory({ base }: { base: string }) {
	const [items, setItems] = useState<PromptSummary[]>([]),
		[offset, setOffset] = useState<number | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState(''),
		[preview, setPreview] = useState<Prompt | null>(null);
	const generation = useRef(0),
		active = useRef(true);
	useEffect(() => {
		const counter = generation;
		active.current = true;
		let valid = true;
		void projectRequest<PromptPage>(`${base}/revisions`)
			.then(page => {
				if (valid) {
					setItems(page.items);
					setOffset(page.next_offset);
				}
			})
			.catch(e => {
				if (valid) setError(e.message);
			})
			.finally(() => {
				if (valid) setLoading(false);
			});
		return () => {
			valid = false;
			active.current = false;
			counter.current++;
		};
	}, [base]);
	async function view(revision: number) {
		const id = ++generation.current;
		setLoading(true);
		setError('');
		try {
			const value = await projectRequest<Prompt>(
				`${base}/revisions/${revision}`,
			);
			if (id === generation.current && active.current)
				setPreview(value);
		} catch (e) {
			if (id === generation.current && active.current)
				setError(
					e instanceof Error
						? e.message
						: 'Unable to load revision.',
				);
		} finally {
			if (id === generation.current && active.current)
				setLoading(false);
		}
	}
	async function more() {
		if (offset === null) return;
		setLoading(true);
		try {
			const page = await projectRequest<PromptPage>(
				`${base}/revisions?offset=${offset}`,
			);
			if (active.current) {
				setItems(old => [...old, ...page.items]);
				setOffset(page.next_offset);
			}
		} catch (e) {
			if (active.current)
				setError(
					e instanceof Error
						? e.message
						: 'Unable to load history.',
				);
		} finally {
			if (active.current) setLoading(false);
		}
	}
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
								{new Date(
									item.created_at,
								).toLocaleString()}
							</small>
						</div>
						<button
							className='button'
							disabled={loading}
							aria-label={`View revision ${item.revision}`}
							onClick={() =>
								void view(
									item.revision,
								)
							}>
							View
						</button>
					</li>
				))}
			</ol>
			{offset !== null && (
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
