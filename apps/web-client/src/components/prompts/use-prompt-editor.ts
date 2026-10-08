'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { projectRequest, ProjectRequestError } from '@/lib/projects/client';
import { type Prompt, type PromptSummary, type PromptType } from '@/types/prompt';
import { useModalDialog } from '@/hooks/use-modal-dialog';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { projectWrite } from '@/lib/projects/client';

type Props = {
	projectId: string;
	initial: PromptSummary | null;
	canEdit: boolean;
	onClose: () => void;
	onSaved: () => void;
};

export function usePromptEditor({
	projectId,
	initial,
	canEdit,
	onClose,
	onSaved,
}: Props) {
	const dialog = useModalDialog();
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
		if(!initial) return;
		let active = true;
		const controller = new AbortController();
		void projectRequest<Prompt>(`${base}/${initial.id}`, {
			signal: controller.signal,
		})
			.then(prompt => {
				if(active) apply(prompt);
			})
			.catch(e => {
				if(active) setError(e.message);
			})
			.finally(() => {
				if(active) setLoading(false);
			});
		return () => {
			active = false;
			controller.abort();
		};
	}, [base, initial]);
	useUnsavedChanges(dirty);
	function close() {
		if(busy) return;
		if(dirty) {
			setDiscard(true);
			return;
		}
		onClose();
	}
	async function save(event: FormEvent) {
		event.preventDefault();
		if(!editable || busy) return;
		setBusy(true);
		setError('');
		setNotice('');
		try {
			const prompt = await projectWrite<Prompt>(current
				? `${base}/${current.id}/revisions`
				: base, 'POST', {
				name,
				description,
				content,
				...(current
					? {
						base_revision:
							current.revision,
					}
					: { type }),
			});
			apply(prompt);
			setNotice(`Revision ${prompt.revision} saved.`);
			onSaved();
		} catch(e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to save prompt.',
			);
			if(
				e instanceof ProjectRequestError &&
				[403, 404].includes(e.status)
			)
				setDenied(true);
		} finally {
			setBusy(false);
		}
	}
	return {
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
	};
}
