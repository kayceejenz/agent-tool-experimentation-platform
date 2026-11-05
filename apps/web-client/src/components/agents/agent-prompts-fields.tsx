'use client';
import type { useAgentEditor } from '@/components/agents/use-agent-editor';
import { PromptPicker } from './prompt-picker';

type Props = Pick<
	ReturnType<typeof useAgentEditor>,
	| 'system'
	| 'setSystem'
	| 'agentPrompt'
	| 'setAgentPrompt'
	| 'setPickerBusy'
	| 'disabled'
> & { projectId: string };

export function AgentPromptsFields({
	system,
	setSystem,
	agentPrompt,
	setAgentPrompt,
	setPickerBusy,
	disabled,
	projectId,
}: Props) {
	return (
		<>
			<p className='mcp-note'>
				Optional: add reusable instructions to customise this agent. You can
				leave both prompts empty and describe your task in the playground.
			</p>
			<PromptPicker
				projectId={projectId}
				kind='system'
				value={system}
				disabled={disabled}
				onChange={setSystem}
				onBusyChange={setPickerBusy}
			/>
			<PromptPicker
				projectId={projectId}
				kind='agent'
				value={agentPrompt}
				disabled={disabled}
				onChange={setAgentPrompt}
				onBusyChange={setPickerBusy}
			/>
		</>
	);
}
