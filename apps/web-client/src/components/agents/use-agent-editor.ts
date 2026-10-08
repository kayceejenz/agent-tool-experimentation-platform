'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { projectRequest, ProjectRequestError } from '@/lib/projects/client';
import { configOf, newAgent, type Agent, type AgentConfig, type AgentSummary, type PromptBinding, type ToolBinding } from '@/types/agent';
import { useModalDialog } from '@/hooks/use-modal-dialog';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { projectWrite } from '@/lib/projects/client';

export const tabs = [
	'Details',
	'Prompts',
	'Model',
	'Tools',
	'Limits',
	'History',
] as const;

export const wizardSteps = ['Details', 'Prompts', 'Model', 'Tools', 'Limits'] as const;

type Tab = (typeof tabs)[number];

export function useAgentEditor({
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
	const dialog = useModalDialog();
	const [current, setCurrent] = useState<Agent | null>(null),
		[form, setForm] = useState<AgentConfig>(newAgent),
		[system, setSystem] = useState<PromptBinding | null>(null),
		[agentPrompt, setAgentPrompt] = useState<PromptBinding | null>(
			null,
		),
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
			.map(t => ({ id: t.id, revision: t.revision }))
			.sort((a, b) => a.id.localeCompare(b.id)),
	};
	const dirty =
		JSON.stringify(payload) !==
		JSON.stringify(current ? configOf(current) : newAgent);
	const editable =
		canEdit && !denied && !loading && (!initial || !!current);
	const disabled = !editable || busy || pickerBusy;
	function apply(value: Agent) {
		setCurrent(value);
		setForm(configOf(value));
		setSystem(value.system_prompt);
		setAgentPrompt(value.agent_prompt);
		setTools(value.tools);
	}

	useEffect(() => {
		if(!initial) return;
		let active = true;
		const controller = new AbortController();
		void projectRequest<Agent>(`${base}/${initial.id}`, { signal: controller.signal })
			.then(value => {
				if(active) apply(value);
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
	function fail(e: unknown) {
		setError(
			e instanceof Error
				? e.message
				: 'Unable to save agent.',
		);
		if(
			e instanceof ProjectRequestError &&
			[403, 404].includes(e.status)
		)
			setDenied(true);
	}
	function close() {
		if(busy || pickerBusy) return;
		if(dirty) {
			setDiscard(true);
			return;
		}
		onClose();
	}
	async function save(event: FormEvent) {
		event.preventDefault();
		if(disabled) return;
		setBusy(true);
		setError('');
		setNotice('');
		try {
			const saved = await projectWrite<Agent>(current
				? `${base}/${current.id}/revisions`
				: base, 'POST', {
				...payload,
				...(current
					? {
						base_revision:
							current.revision,
					}
					: {}),
			});
			apply(saved);
			setNotice(`Revision ${saved.revision} saved.`);
			onSaved();
		} catch(e) {
			fail(e);
		} finally {
			setBusy(false);
		}
	}
	async function toggle() {
		if(!current || dirty || disabled) return;
		setBusy(true);
		setError('');
		setNotice('');
		try {
			const saved = await projectWrite<Agent>(`${base}/${current.id}`, 'PATCH', {
				enabled: !current.enabled,
				base_revision: current.revision,
			});
			apply(saved);
			setNotice(
				saved.enabled
					? 'Agent enabled. Open its playground to run a task.'
					: 'Agent disabled.',
			);
			onSaved();
		} catch(e) {
			fail(e);
		} finally {
			setBusy(false);
		}
	}
	function field<K extends keyof AgentConfig>(
		key: K,
		value: AgentConfig[K],
	) {
		setForm(old => ({ ...old, [key]: value }));
	}
	const managing = !!initial || !!current;
	return {
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
	};
}
