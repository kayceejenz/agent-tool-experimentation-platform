'use client';
import { useEffect, useRef, useState } from 'react';
import { ProjectSync } from '@/components/projects/project-provider';
import { projectRequest } from '@/lib/projects/client';
import type { Project } from '@/types/workspace';
import {
	promptTypes,
	type PromptPage,
	type PromptSummary,
	type PromptType,
} from '@/types/prompt';
import { PromptEditor } from './prompt-editor';

export function Prompts({ project }: { project: Project }) {
	const [type, setType] = useState<PromptType | ''>('');
	const [generation, setGeneration] = useState(0);
	const [selection, setSelection] = useState<
		PromptSummary | 'new' | null
	>(null);
	const opener = useRef<HTMLElement | null>(null);
	const canEdit = project.role !== 'viewer';
	return (
		<>
			<ProjectSync project={project} />
			<header className='workspace-header'>
				<div>
					<h1>Prompts</h1>
					<p>
						Version the instructions behind
						your agents and evaluations.
					</p>
				</div>
				{canEdit && (
					<button
						className='button primary'
						onClick={e => {
							opener.current =
								e.currentTarget;
							setSelection('new');
						}}>
						Create prompt
					</button>
				)}
			</header>
			<section className='panel'>
				<div className='prompt-toolbar'>
					<label>
						Prompt type{' '}
						<select
							value={type}
							onChange={e =>
								setType(
									e.target
										.value as
										| PromptType
										| '',
								)
							}>
							<option value=''>
								All types
							</option>
							{Object.entries(
								promptTypes,
							).map(
								([
									value,
									item,
								]) => (
									<option
										key={
											value
										}
										value={
											value
										}>
										{
											item.label
										}
									</option>
								),
							)}
						</select>
					</label>
					<button
						className='button'
						onClick={() =>
							setGeneration(
								old => old + 1,
							)
						}>
						Refresh
					</button>
				</div>
				<PromptList
					key={`${type}-${generation}`}
					projectId={project.id}
					type={type}
					onSelect={(prompt, button) => {
						opener.current = button;
						setSelection(prompt);
					}}
				/>
			</section>
			{selection && (
				<PromptEditor
					projectId={project.id}
					initial={
						selection === 'new'
							? null
							: selection
					}
					canEdit={canEdit}
					onSaved={() =>
						setGeneration(old => old + 1)
					}
					onClose={() => {
						setSelection(null);
						requestAnimationFrame(() =>
							opener.current
								?.isConnected
								? opener.current.focus()
								: document
										.querySelector<HTMLButtonElement>(
											'.prompt-toolbar button',
										)
										?.focus(),
						);
					}}
				/>
			)}
		</>
	);
}
function PromptList({
	projectId,
	type,
	onSelect,
}: {
	projectId: string;
	type: PromptType | '';
	onSelect: (prompt: PromptSummary, button: HTMLElement) => void;
}) {
	const [items, setItems] = useState<PromptSummary[]>([]),
		[offset, setOffset] = useState<number | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState('');
	const active = useRef(true);
	const base = `/${projectId}/prompts?type=${type}`;
	const path = type ? base : `/${projectId}/prompts?`;
	useEffect(() => {
		active.current = true;
		let valid = true;
		void projectRequest<PromptPage>(path)
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
		};
	}, [path]);
	async function more() {
		if (offset === null) return;
		setLoading(true);
		setError('');
		try {
			const page = await projectRequest<PromptPage>(
				`${path}&offset=${offset}`,
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
						: 'Unable to load prompts.',
				);
		} finally {
			if (active.current) setLoading(false);
		}
	}
	return (
		<>
			{error && (
				<p
					className='mcp-feedback mcp-error'
					role='alert'>
					{error}
				</p>
			)}
			{loading && !items.length ? (
				<p className='mcp-feedback' role='status'>
					Loading prompts…
				</p>
			) : !items.length && !error ? (
				<div className='empty-state'>
					<h2>
						{type
							? 'No prompts of this type'
							: 'No prompts yet'}
					</h2>
					<p>
						Create system instructions,
						agent workflows, or evaluation
						criteria.
					</p>
				</div>
			) : (
				!!items.length && (
					<div className='tool-table-wrap'>
						<table className='tool-table'>
							<thead>
								<tr>
									<th>
										Name
									</th>
									<th>
										Type
									</th>
									<th>
										Revision
									</th>
									<th>
										Last
										updated
									</th>
									<th>
										Action
									</th>
								</tr>
							</thead>
							<tbody>
								{items.map(
									prompt => (
										<tr
											key={
												prompt.id
											}>
											<td>
												<strong>
													{
														prompt.name
													}
												</strong>
												<p className='tool-description'>
													{prompt.description ||
														'No description'}
												</p>
											</td>
											<td>
												<span className='badge'>
													{
														promptTypes[
															prompt
																.type
														]
															.label
													}
												</span>
											</td>
											<td>
												v
												{
													prompt.revision
												}
											</td>
											<td>
												<time
													dateTime={
														prompt.created_at
													}>
													{new Date(
														prompt.created_at,
													).toLocaleString()}
												</time>
											</td>
											<td>
												<button
													className='button'
													aria-label={`Manage ${prompt.name}`}
													onClick={e =>
														onSelect(
															prompt,
															e.currentTarget,
														)
													}>
													Manage
												</button>
											</td>
										</tr>
									),
								)}
							</tbody>
						</table>
					</div>
				)
			)}
			{offset !== null && (
				<div className='mcp-feedback'>
					<button
						className='button'
						disabled={loading}
						onClick={() => void more()}>
						Load more prompts
					</button>
				</div>
			)}
		</>
	);
}
