'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { type AgentSummary } from '@/types/agent';
import { AgentHistory } from './agent-history';
import { useAgentEditor, tabs } from '@/components/agents/use-agent-editor';
import { AgentDetailsFields } from './agent-details-fields';
import { AgentEvaluationFields } from './agent-evaluation-fields';
import { AgentPromptsFields } from './agent-prompts-fields';
import { AgentModelFields } from './agent-model-fields';
import { AgentToolsFields } from './agent-tools-fields';
import { AgentLimitsFields } from './agent-limits-fields';
import { UnsavedChanges } from '@/components/unsaved-changes';

export function AgentEditor({
	projectId,
	initial,
	canEdit,
	onClose,
	onSaved,
	pageMode = false,
}: {
	projectId: string;
	initial: AgentSummary | null;
	canEdit: boolean;
	onClose: () => void;
	onSaved: (agent: import('@/types/agent').Agent) => void;
	pageMode?: boolean;
}) {
	const {
		dialog,
		pendingNavigation,
		setPendingNavigation,
		current,
		form,
		system,
		setSystem,
		agentPrompt,
		setAgentPrompt,
		evaluationPrompt,
		setEvaluationPrompt,
		tools,
		setTools,
		tab,
		setTab,
		loading,
		busy,
		pickerBusy,
		setPickerBusy,
		error,
		notice,
		discard,
		setDiscard,
		base,
		dirty,
		disabled,
		close,
		save,
		toggle,
		field,
		managing,
	} = useAgentEditor({
		projectId,
		initial,
		canEdit,
		onClose,
		onSaved,
		pageMode,
	});
	const router = useRouter();
	const sectionHeading = useRef<HTMLHeadingElement>(null);
	const previousSection = useRef(tab);
	useEffect(() => {
		const next = tab;
		if (previousSection.current !== next) {
			sectionHeading.current?.focus();
			previousSection.current = next;
		}
	}, [tab]);
	const content = (
		<>
			<header className='mcp-sheet-header'>
				<div>
					<p className='eyebrow'>
						{current
							? `Revision ${current.revision} · ${current.enabled ? 'Enabled' : 'Disabled'}`
							: 'Agent configuration'}
					</p>
					<h2 id='agent-title'>
						{current?.name ?? (managing ? 'Manage agent' : 'Create agent')}
					</h2>
				</div>
				<button
					className='button'
					disabled={busy || pickerBusy}
					onClick={close}>
					{pageMode ? 'Back to agents' : 'Close'}
				</button>
			</header>
			<div className='mcp-sheet-body'>
				{discard && (
					<UnsavedChanges
						onKeepEditing={() => {
							setDiscard(false);
							setPendingNavigation(null);
						}}
						onDiscard={() => {
							if (pendingNavigation) router.push(pendingNavigation);
							else onClose();
						}}
					/>
				)}
				{error && (
					<p className='mcp-error' role='alert'>
						{error}
					</p>
				)}
				{notice && <p role='status'>{notice}</p>}
				{managing && (
					<div
						className='prompt-tabs agent-tabs'
						role='group'
						aria-label='Agent configuration sections'>
						{tabs
							.filter(t => t !== 'History' || current)
							.map(item => (
								<button
									type='button'
									key={item}
									className='button'
									disabled={busy || pickerBusy}
									aria-pressed={item === tab}
									onClick={() => setTab(item)}>
									{item}
								</button>
							))}
					</div>
				)}
				<h3
					ref={sectionHeading}
					tabIndex={-1}
					className='configuration-section-title'>
					{managing ? tab : 'Name and model'}
				</h3>
				{!canEdit && <p className='mcp-note'>You have read-only access.</p>}
				{loading ? (
					<p role='status'>Loading agent…</p>
				) : managing && tab === 'History' && current ? (
					<AgentHistory
						key={`${current.id}-${current.revision}`}
						base={`${base}/${current.id}`}
					/>
				) : (
					<form onSubmit={save}>
						{!managing && (
							<p className='mcp-note'>
								Give your agent a name and choose a model. To analyse a dataset,
								select it in the playground; file and Python tools are provided
								automatically. Custom prompts and MCP tools are optional.
							</p>
						)}
						{(!managing || tab === 'Details') && (
							<AgentDetailsFields
								current={current}
								form={form}
								dirty={dirty}
								disabled={disabled}
								toggle={toggle}
								field={field}
								managing={managing}
							/>
						)}
						{(!managing || tab === 'Model') && (
							<AgentModelFields form={form} disabled={disabled} field={field} />
						)}
						{(!managing || tab === 'Prompts') && (
							<details
								className='advanced-settings'
								open={managing || undefined}>
								<summary>Custom prompts (optional)</summary>
								<AgentPromptsFields
									system={system}
									setSystem={setSystem}
									agentPrompt={agentPrompt}
									setAgentPrompt={setAgentPrompt}
									setPickerBusy={setPickerBusy}
									disabled={disabled}
									projectId={projectId}
								/>
							</details>
						)}
						{(!managing || tab === 'Tools') && (
							<details
								className='advanced-settings'
								open={managing || undefined}>
								<summary>MCP tools (optional)</summary>
								<AgentToolsFields
									tools={tools}
									setTools={setTools}
									disabled={disabled}
									projectId={projectId}
								/>
							</details>
						)}
						{(!managing || tab === 'Limits') && (
							<details
								className='advanced-settings'
								open={managing || undefined}>
								<summary>
									Advanced execution settings{' '}
									<span>
										{form.limits.max_turns} turns ·{' '}
										{form.limits.timeout_seconds}s timeout
									</span>
								</summary>
								<AgentLimitsFields
									form={form}
									disabled={disabled}
									field={field}
								/>
							</details>
						)}
						{(!managing || tab === 'Evaluation') && (
							<details
								className='advanced-settings'
								open={managing || undefined}>
								<summary>Evaluation settings</summary>
								<AgentEvaluationFields
									form={form}
									field={field}
									evaluationPrompt={evaluationPrompt}
									setEvaluationPrompt={setEvaluationPrompt}
									setPickerBusy={setPickerBusy}
									disabled={disabled}
									projectId={projectId}
								/>
							</details>
						)}
						{canEdit && (
							<footer className='agent-save'>
								<p className='mcp-note'>
									You can save an incomplete configuration. Changed
									configurations create a new revision and start disabled.
								</p>
								{!managing && (
									<button
										className='button primary'
										type='submit'
										disabled={disabled || !form.name.trim()}>
										{busy ? 'Creating…' : 'Create agent'}
									</button>
								)}
								{managing && (
									<button
										className='button primary'
										type='submit'
										disabled={disabled || !dirty || !form.name.trim()}>
										{busy ? 'Saving…' : 'Save new revision'}
									</button>
								)}
							</footer>
						)}
					</form>
				)}
				{current && pageMode && (
					<div className='agent-next-actions'>
						{dirty ? (
							<p>Save your changes before running this configuration.</p>
						) : current.enabled ? (
							<Link
								className='button primary'
								href={`/projects/${projectId}/agents/${current.id}/playground`}>
								Open playground
							</Link>
						) : canEdit && current.configuration_ready ? (
							<button
								type='button'
								className='button primary'
								disabled={disabled}
								onClick={async () => {
									const saved = await toggle();
									if (saved?.enabled)
										router.push(
											`/projects/${projectId}/agents/${saved.id}/playground`,
										);
								}}>
								Enable and open playground
							</button>
						) : (
							<p>Complete the configuration to enable this agent.</p>
						)}
					</div>
				)}
			</div>
		</>
	);
	if (pageMode)
		return (
			<section className='agent-page-panel' aria-label='Agent configuration'>
				{content}
			</section>
		);
	return (
		<dialog
			ref={dialog}
			className={`mcp-sheet agent-sheet${managing ? '' : ' agent-create-dialog'}`}
			aria-labelledby='agent-title'
			onCancel={event => {
				event.preventDefault();
				close();
			}}>
			{content}
		</dialog>
	);
}
