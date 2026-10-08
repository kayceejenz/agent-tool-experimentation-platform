'use client';
import { type AgentSummary } from '@/types/agent';
import { AgentHistory } from './agent-history';
import { useAgentEditor, tabs, wizardSteps } from '@/components/agents/use-agent-editor';
import { AgentDetailsFields } from './agent-details-fields';
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
}: {
	projectId: string;
	initial: AgentSummary | null;
	canEdit: boolean;
	onClose: () => void;
	onSaved: () => void;
}) {
	const {
		dialog,
		current,
		form,
		system,
		setSystem,
		agentPrompt,
		setAgentPrompt,
		tools,
		setTools,
		tab,
		setTab,
		step,
		setStep,
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
	} = useAgentEditor({ projectId, initial, canEdit, onClose, onSaved });
	return (
		<dialog
			ref={dialog}
			className={`mcp-sheet agent-sheet${managing ? '' : ' agent-create-dialog'}`}
			aria-labelledby='agent-title'
			onCancel={event => {
				event.preventDefault();
				close();
			}}>
			<header className='mcp-sheet-header'>
				<div>
					<p className='eyebrow'>
						{current
							? `Revision ${current.revision} · ${current.enabled ? 'Enabled' : 'Disabled'}`
							: 'Agent configuration'}
					</p>
					<h2 id='agent-title'>
						{current?.name ??
							(managing
								? 'Manage agent'
								: 'Create agent')}
					</h2>
				</div>
				<button
					className='button'
					disabled={busy || pickerBusy}
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
				{!managing && (
					<div
						className='prompt-tabs agent-tabs agent-wizard-steps'
						role='group'
						aria-label='Agent creation wizard steps'>
						{wizardSteps.map(
							(item, index) => (
								<button
									type='button'
									key={item}
									className='button'
									disabled={
										busy ||
										pickerBusy
									}
									aria-pressed={
										index ===
										step
									}
									onClick={() => setStep(index)}>
									{index +
										1}
									. {item}
								</button>
							),
						)}
					</div>
				)}
				{managing && (
					<div
						className='prompt-tabs agent-tabs'
						role='group'
						aria-label='Agent configuration sections'>
						{tabs
							.filter(
								t =>
									t !==
									'History' ||
									current,
							)
							.map(item => (
								<button
									type='button'
									key={item}
									className='button'
									disabled={
										busy ||
										pickerBusy
									}
									aria-pressed={
										item ===
										tab
									}
									onClick={() => setTab(item)}>
									{item}
								</button>
							))}
					</div>
				)}
				{!canEdit && (
					<p className='mcp-note'>
						You have read-only access.
					</p>
				)}
				{loading ? (
					<p role='status'>Loading agent…</p>
				) : managing && tab === 'History' && current ? (
					<AgentHistory
						key={`${current.id}-${current.revision}`}
						base={`${base}/${current.id}`}
					/>
				) : (
					<form onSubmit={save}>
						{(managing
							? tab === 'Details'
							: step === 0) && <AgentDetailsFields
								current={current}
								form={form}
								dirty={dirty}
								disabled={disabled}
								toggle={toggle}
								field={field}
								managing={managing}
							/>}
						{(managing
							? tab === 'Prompts'
							: step === 1) && <AgentPromptsFields
								system={system}
								setSystem={setSystem}
								agentPrompt={agentPrompt}
								setAgentPrompt={setAgentPrompt}
								setPickerBusy={setPickerBusy}
								disabled={disabled}
								projectId={projectId}
							/>}
						{(managing
							? tab === 'Model'
							: step === 2) && <AgentModelFields form={form} disabled={disabled} field={field} />}
						{(managing
							? tab === 'Tools'
							: step === 3) && <AgentToolsFields tools={tools} setTools={setTools} disabled={disabled} projectId={projectId} />}
						{(managing
							? tab === 'Limits'
							: step === 4) && <AgentLimitsFields form={form} disabled={disabled} field={field} />}
						{canEdit && (
							<footer className='agent-save'>
								<p className='mcp-note'>
									You can
									save an
									incomplete
									configuration.
									Changed
									configurations
									create a
									new
									revision
									and
									start
									disabled.
								</p>
								{!managing && (
									<div
										style={{
											display: 'flex',
											gap: '8px',
											justifyContent:
												'flex-end',
										}}>
										{step >
											0 && (
												<button
													type='button'
													className='button'
													disabled={
														busy ||
														pickerBusy
													}
													onClick={() =>
														setStep(
															s =>
																s -
																1,
														)
													}>
													Back
												</button>
											)}
										{step <
											wizardSteps.length -
											1 && (
												<button
													type='button'
													className='button primary'
													disabled={
														busy ||
														pickerBusy ||
														(step ===
															0 &&
															!form.name.trim())
													}
													onClick={() =>
														setStep(
															s =>
																s +
																1,
														)
													}>
													Next
												</button>
											)}
										{step ===
											wizardSteps.length -
											1 && (
												<button
													className='button primary'
													type='submit'
													disabled={
														disabled ||
														!dirty ||
														!form.name.trim()
													}>
													{busy
														? 'Saving…'
														: 'Create agent'}
												</button>
											)}
									</div>
								)}
								{managing && (
									<button
										className='button primary'
										type='submit'
										disabled={
											disabled ||
											!dirty ||
											!form.name.trim()
										}>
										{busy
											? 'Saving…'
											: 'Save new revision'}
									</button>
								)}
							</footer>
						)}
					</form>
				)}
			</div>
		</dialog>
	);
}
