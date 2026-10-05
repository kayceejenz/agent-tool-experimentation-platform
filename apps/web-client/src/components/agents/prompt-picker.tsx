'use client';
import { useEffect, useState } from 'react';
import { projectRequest } from '@/lib/projects/client';
import type { Prompt, PromptPage, PromptSummary } from '@/types/prompt';
import type { PromptBinding } from '@/types/agent';
export function PromptPicker({
	projectId,
	kind,
	value,
	disabled,
	onChange,
	onBusyChange,
}: {
	projectId: string;
	kind: 'system' | 'agent';
	value: PromptBinding | null;
	disabled: boolean;
	onChange: (value: PromptBinding | null) => void;
	onBusyChange: (busy: boolean) => void;
}) {
	const [choices, setChoices] = useState<PromptSummary[]>([]),
		[revisions, setRevisions] = useState<PromptSummary[]>([]),
		[older, setOlder] = useState<number | null>(null),
		[busy, setBusy] = useState(false),
		[error, setError] = useState('');
	const base = `/${projectId}/prompts`;
	useEffect(() => {
		let active = true;
		async function load() {
			const items: PromptSummary[] = [];
			let offset: number | null = 0;
			do {
				const page: PromptPage = await projectRequest(
					`${base}?type=${kind}&offset=${offset}`,
				);
				items.push(...page.items);
				offset = page.next_offset;
			} while (offset !== null && active);
			return items;
		}
		void load()
			.then((items) => {
				if (active) setChoices(items);
			})
			.catch((e) => {
				if (active) setError(e.message);
			});
		return () => {
			active = false;
		};
	}, [base, kind]);
	const identifier = value?.id;
	useEffect(() => {
		if (!identifier) return;
		let active = true;
		void projectRequest<PromptPage>(`${base}/${identifier}/revisions`)
			.then((page) => {
				if (active) {
					setRevisions(page.items);
					setOlder(page.next_offset);
				}
			})
			.catch((e) => {
				if (active) setError(e.message);
			});
		return () => {
			active = false;
		};
	}, [base, identifier]);
	async function select(id: string, revision?: number) {
		if (!id) {
			onChange(null);
			return;
		}
		setBusy(true);
		onBusyChange(true);
		setError('');
		try {
			const prompt = await projectRequest<Prompt>(
				`${base}/${id}${revision ? `/revisions/${revision}` : ''}`,
			);
			onChange({
				...prompt,
				latest_revision:
					choices.find((p) => p.id === id)?.revision ??
					value?.latest_revision ??
					prompt.revision,
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Unable to load prompt.');
		} finally {
			setBusy(false);
			onBusyChange(false);
		}
	}
	async function more() {
		if (!value || older === null) return;
		setBusy(true);
		onBusyChange(true);
		try {
			const page = await projectRequest<PromptPage>(
				`${base}/${value.id}/revisions?offset=${older}`,
			);
			setRevisions((old) => [...old, ...page.items]);
			setOlder(page.next_offset);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Unable to load revisions.');
		} finally {
			setBusy(false);
			onBusyChange(false);
		}
	}
	const label = kind === 'system' ? 'System prompt' : 'Agent prompt';
	const options =
		value && !choices.some((p) => p.id === value.id)
			? [value, ...choices]
			: choices;
	const versions = revisions.filter((r) => r.id === identifier);
	const withSelected =
		value && !versions.some((r) => r.revision === value.revision)
			? [value, ...versions]
			: versions;
	return (
		<section className="agent-section">
			<label className="tool-field">
				{label}
				<select
					value={value?.id ?? ''}
					disabled={disabled || busy}
					onChange={(e) => void select(e.target.value)}
				>
					<option value="">Not selected</option>
					{options.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</select>
			</label>
			{error && (
				<p className="mcp-error" role="alert">
					{error}
				</p>
			)}
			{value && (
				<>
					<label className="tool-field">
						{label} revision
						<select
							disabled={disabled || busy}
							value={value.revision}
							onChange={(e) => void select(value.id, Number(e.target.value))}
						>
							{withSelected.map((r) => (
								<option key={r.revision} value={r.revision}>
									Revision {r.revision}
									{r.revision === value.latest_revision ? ' (latest)' : ''}
								</option>
							))}
						</select>
					</label>
					{older !== null && (
						<button
							type="button"
							className="button"
							disabled={busy}
							onClick={() => void more()}
						>
							Load older {kind} revisions
						</button>
					)}
					{value.latest_revision > value.revision && (
						<p className="mcp-note">
							Revision {value.latest_revision} is available. This agent keeps
							revision {value.revision} until you select another.
						</p>
					)}
					<details className="agent-preview">
						<summary>Preview {label.toLowerCase()}</summary>
						<pre>{value.content}</pre>
					</details>
				</>
			)}
		</section>
	);
}
