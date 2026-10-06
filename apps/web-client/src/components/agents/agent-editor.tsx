'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { projectRequest, ProjectRequestError } from '@/lib/projects/client';
import {
	configOf,
	newAgent,
	type Agent,
	type AgentConfig,
	type AgentSummary,
	type PromptBinding,
	type ToolBinding,
} from '@/types/agent';
import { PromptPicker } from './prompt-picker';
import { ToolPicker } from './tool-picker';
import { AgentHistory } from './agent-history';
	const tabs = [
		'Details',
		'Prompts',
		'Model',
		'Tools',
		'Limits',
		'History',
	] as const;
	const wizardSteps = [
		'Details',
		'Prompts',
		'Model',
		'Tools',
		'Limits',
	] as const;
	type Tab = (typeof tabs)[number];
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
	const dialog = useRef<HTMLDialogElement>(null);
	const [current, setCurrent] = useState<Agent | null>(null),
		[form, setForm] = useState<AgentConfig>(newAgent),
		[system, setSystem] = useState<PromptBinding | null>(null),
		[agentPrompt, setAgentPrompt] = useState<PromptBinding | null>(null),
		[tools, setTools] = useState<ToolBinding[]>([]),
		[tab, setTab] = useState<Tab>('Details'),
		[step, setStep] = useState<number>(0);
	const [loading, setLoading] = useState(!!initial),
		[busy, setBusy] = useState(false),
		[pickerBusy, setPickerBusy] = useState(false),
		[error, setError] = useState(''),
		[notice, setNotice] = useState(''),
		[discard, setDiscard] = useState(false),
		[denied, setDenied] = useState(false);
	const base = `/${projectId}/agents`;
	const reference = (value: PromptBinding | null) =>
		value ? { id: value.id, revision: value.revision } : null;
	const payload: AgentConfig = {
		...form,
		system_prompt: reference(system),
		agent_prompt: reference(agentPrompt),
		tools: tools
			.map((t) => ({ id: t.id, revision: t.revision }))
			.sort((a, b) => a.id.localeCompare(b.id)),
	};
	const dirty =
		JSON.stringify(payload) !==
		JSON.stringify(current ? configOf(current) : newAgent);
	const editable = canEdit && !denied && !loading && (!initial || !!current);
	const disabled = !editable || busy || pickerBusy;
	function apply(value: Agent) {
		setCurrent(value);
		setForm(configOf(value));
		setSystem(value.system_prompt);
		setAgentPrompt(value.agent_prompt);
		setTools(value.tools);
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
		void projectRequest<Agent>(`${base}/${initial.id}`)
			.then((value) => {
				if (active) apply(value);
			})
			.catch((e) => {
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
		return () => window.removeEventListener('beforeunload', prevent);
	}, [dirty]);
	function fail(e: unknown) {
		setError(e instanceof Error ? e.message : 'Unable to save agent.');
		if (e instanceof ProjectRequestError && [403, 404].includes(e.status))
			setDenied(true);
	}
	function close() {
		if (busy || pickerBusy) return;
		if (dirty) {
			setDiscard(true);
			return;
		}
		onClose();
	}
	async function save(event: FormEvent) {
		event.preventDefault();
		if (disabled) return;
		setBusy(true);
		setError('');
		setNotice('');
		try {
			const saved = await projectRequest<Agent>(
				current ? `${base}/${current.id}/revisions` : base,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						...payload,
						...(current ? { base_revision: current.revision } : {}),
					}),
				},
			);
			apply(saved);
			setNotice(`Revision ${saved.revision} saved.`);
			onSaved();
		} catch (e) {
			fail(e);
		} finally {
			setBusy(false);
		}
	}
	async function toggle() {
		if (!current || dirty || disabled) return;
		setBusy(true);
		setError('');
		setNotice('');
		try {
			const saved = await projectRequest<Agent>(`${base}/${current.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					enabled: !current.enabled,
					base_revision: current.revision,
				}),
			});
			apply(saved);
			setNotice(
				saved.enabled
					? 'Agent enabled. Open its playground to run a task.'
					: 'Agent disabled.',
			);
			onSaved();
		} catch (e) {
			fail(e);
		} finally {
			setBusy(false);
		}
	}
	function field<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) {
		setForm((old) => ({ ...old, [key]: value }));
	}
	const managing = !!initial || !!current;
	return (
		<dialog
			ref={dialog}
			className={`mcp-sheet agent-sheet${managing ? '' : ' agent-create-dialog'}`}
			aria-labelledby="agent-title"
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
		>
			<header className="mcp-sheet-header">
				<div>
					<p className="eyebrow">
						{current
							? `Revision ${current.revision} · ${current.enabled ? 'Enabled' : 'Disabled'}`
							: 'Agent configuration'}
					</p>
					<h2 id="agent-title">
						{current?.name ?? (managing ? 'Manage agent' : 'Create agent')}
					</h2>
				</div>
				<button
					className="button"
					disabled={busy || pickerBusy}
					onClick={close}
				>
					Close
				</button>
			</header>
			<div className="mcp-sheet-body">
				{discard && (
					<div className="prompt-discard" role="alert">
						<p>You have unsaved changes.</p>
						<div className="mcp-header-actions">
							<button className="button" onClick={() => setDiscard(false)}>
								Keep editing
							</button>
							<button className="button" onClick={onClose}>
								Discard changes
							</button>
						</div>
					</div>
				)}
				{error && (
					<p className="mcp-error" role="alert">
						{error}
					</p>
				)}
				{notice && <p role="status">{notice}</p>}
				{!managing && (
					<div
						className="prompt-tabs agent-tabs agent-wizard-steps"
						role="group"
						aria-label="Agent creation wizard steps"
					>
						{wizardSteps.map((item, index) => (
							<button
								type="button"
								key={item}
								className="button"
								disabled={busy || pickerBusy}
								aria-pressed={index === step}
								onClick={() => setStep(index)}
							>
								{index + 1}. {item}
							</button>
						))}
					</div>
				)}
				{managing && (
					<div
						className="prompt-tabs agent-tabs"
						role="group"
						aria-label="Agent configuration sections"
					>
						{tabs
							.filter((t) => t !== 'History' || current)
							.map((item) => (
								<button
									type="button"
									key={item}
									className="button"
									disabled={busy || pickerBusy}
									aria-pressed={item === tab}
									onClick={() => setTab(item)}
								>
									{item}
								</button>
							))}
					</div>
				)}
				{!canEdit && <p className="mcp-note">You have read-only access.</p>}
				{loading ? (
					<p role="status">Loading agent…</p>
				) : managing && tab === 'History' && current ? (
					<AgentHistory
						key={`${current.id}-${current.revision}`}
						base={`${base}/${current.id}`}
					/>
				) : (
					<form onSubmit={save}>
						{(managing ? tab === 'Details' : step === 0) && (
							<>
								<label className="tool-field">
									Name
									<input
										autoFocus={!managing}
										required
										maxLength={160}
										disabled={disabled}
										value={form.name}
										onChange={(e) => field('name', e.target.value)}
									/>
								</label>
								<label className="tool-field">
									Description
									<textarea
										maxLength={2000}
										rows={3}
										disabled={disabled}
										value={form.description}
										onChange={(e) => field('description', e.target.value)}
									/>
								</label>
								{current && (
									<section className="agent-section">
										<div className="mcp-sheet-section-heading">
											<h3>Availability</h3>
											<button
												type="button"
												role="switch"
												className="mcp-toggle"
												aria-label="Enable agent"
												aria-checked={current.enabled}
												disabled={
													disabled ||
													dirty ||
													(!current.enabled && !current.configuration_ready)
												}
												onClick={() => void toggle()}
											>
												<span aria-hidden />
												<span>{current.enabled ? 'Enabled' : 'Disabled'}</span>
											</button>
										</div>
										{dirty && (
											<p className="mcp-note">
												Save your changes before changing availability.
											</p>
										)}
										<h4>Saved configuration</h4>
										{current.configuration_issues.length ? (
											<ul className="agent-issues">
												{current.configuration_issues.map((issue) => (
													<li key={issue}>{issue}</li>
												))}
											</ul>
										) : (
											<p className="mcp-note">
												Configuration complete. Provider compatibility and
												credentials will be checked when model integration is
												added.
											</p>
										)}
										<p className="mcp-note">
											Model execution and the playground are not available yet.
										</p>
									</section>
								)}
							</>
						)}
						{(managing ? tab === 'Prompts' : step === 1) && (
							<>
								<p className="mcp-note">
									Select exact revisions. Evaluation prompts belong to
									experiment evaluation, not agent instructions.
								</p>
								<PromptPicker
									projectId={projectId}
									kind="system"
									value={system}
									disabled={disabled}
									onChange={setSystem}
									onBusyChange={setPickerBusy}
								/>
								<PromptPicker
									projectId={projectId}
									kind="agent"
									value={agentPrompt}
									disabled={disabled}
									onChange={setAgentPrompt}
									onBusyChange={setPickerBusy}
								/>
							</>
						)}
						{(managing ? tab === 'Model' : step === 2) && (
							<>
								<p className="mcp-note">
									Save the intended provider and model identifiers. Supported
									settings and credentials will be validated in the model
									integration increment. Do not enter API keys here.
								</p>
								<label className="tool-field">
									Provider
									<input
										maxLength={80}
										pattern="[a-zA-Z0-9_.\-]*"
										value={form.model_settings.provider}
										disabled={disabled}
										onChange={(e) =>
											field('model_settings', {
												...form.model_settings,
												provider: e.target.value,
											})
										}
									/>
								</label>
								<label className="tool-field">
									Model identifier
									<input
										maxLength={160}
										value={form.model_settings.model}
										disabled={disabled}
										onChange={(e) =>
											field('model_settings', {
												...form.model_settings,
												model: e.target.value,
											})
										}
									/>
								</label>
								<label className="tool-field">
									Temperature (optional)
									<input
										type="number"
										min={0}
										max={2}
										step="0.1"
										value={form.model_settings.temperature ?? ''}
										disabled={disabled}
										onChange={(e) =>
											field('model_settings', {
												...form.model_settings,
												temperature:
													e.target.value === '' ? null : Number(e.target.value),
											})
										}
									/>
									<small>
										Leave blank for the model default. Some models may not
										support this setting.
									</small>
								</label>
							</>
						)}
						{(managing ? tab === 'Tools' : step === 3) && (
							<ToolPicker
								projectId={projectId}
								value={tools}
								disabled={disabled}
								onChange={setTools}
							/>
						)}
						{(managing ? tab === 'Limits' : step === 4) && (
							<>
								<p className="mcp-note">
									These budgets are enforced during execution. Zero
									tool calls permits an agent that only answers using its
									instructions.
								</p>
								{(
									[
										['max_turns', 'Maximum model turns', 1, 50],
										['max_tool_calls', 'Maximum tool calls', 0, 100],
										['timeout_seconds', 'Total duration (seconds)', 1, 300],
										[
											'max_output_tokens',
											'Maximum output tokens per response',
											1,
											32000,
										],
									] as const
								).map(([key, label, min, max]) => (
									<label className="tool-field" key={key}>
										{label}
										<input
											type="number"
											required
											min={min}
											max={max}
											step={1}
											disabled={disabled}
											value={form.limits[key]}
											onChange={(e) =>
												field('limits', {
													...form.limits,
													[key]: Number(e.target.value),
												})
											}
										/>
									</label>
								))}
							</>
						)}
						{canEdit && (
							<footer className="agent-save">
								<p className="mcp-note">
									You can save an incomplete configuration. Changed
									configurations create a new revision and start disabled.
								</p>
								{!managing && (
									<div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
									{step > 0 && (
										<button
											type="button"
											className="button"
											disabled={busy || pickerBusy}
											onClick={() => setStep((s) => s - 1)}
										>
											Back
										</button>
									)}
									{step < wizardSteps.length - 1 && (
										<button
											type="button"
											className="button primary"
											disabled={busy || pickerBusy || (step === 0 && !form.name.trim())}
											onClick={() => setStep((s) => s + 1)}
										>
											Next
										</button>
									)}
									{step === wizardSteps.length - 1 && (
										<button
											className="button primary"
											type="submit"
											disabled={disabled || !dirty || !form.name.trim()}
										>
											{busy ? 'Saving…' : 'Create agent'}
										</button>
									)}
								</div>
								)}
								{managing && (
									<button
										className="button primary"
										type="submit"
										disabled={disabled || !dirty || !form.name.trim()}
									>
										{busy ? 'Saving…' : 'Save new revision'}
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
