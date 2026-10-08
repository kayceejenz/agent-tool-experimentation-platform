'use client';
import { promptTypes, type PromptSummary, type PromptType } from '@/types/prompt';
import { usePromptEditor } from '@/components/prompts/use-prompt-editor';
import { PromptHistory } from './prompt-history';
import { UnsavedChanges } from '@/components/unsaved-changes';

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
	const {
		dialog,
		current,
		name,
		setName,
		description,
		setDescription,
		content,
		setContent,
		type,
		setType,
		loading,
		busy,
		error,
		notice,
		discard,
		setDiscard,
		tab,
		setTab,
		base,
		dirty,
		editable,
		close,
		save,
	} = usePromptEditor({ projectId, initial, canEdit, onClose, onSaved });
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
					<UnsavedChanges onKeepEditing={() => setDiscard(false)} onDiscard={onClose} />
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
							aria-pressed={tab === 'edit'}
							onClick={() => setTab('edit')}>
							Current revision
						</button>
						<button
							className='button'
							aria-pressed={
								tab ===
								'history'
							}
							onClick={() => setTab('history')}>
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
								autoFocus={!initial}
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
											key={key}
											value={key}>
											{item.label}
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
								value={description}
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
								maxLength={32000}
								value={content}
								disabled={
									!editable ||
									busy
								}
								spellCheck={false}
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
