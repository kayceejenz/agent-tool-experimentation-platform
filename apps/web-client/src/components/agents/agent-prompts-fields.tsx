'use client';
import type { useAgentEditor } from '@/components/agents/use-agent-editor';
import { PromptPicker } from './prompt-picker';

type Props = Pick<ReturnType<typeof useAgentEditor>, 'system'
	| 'setSystem'
	| 'agentPrompt'
	| 'setAgentPrompt'
	| 'setPickerBusy'
	| 'disabled'> & { projectId: string };

export function AgentPromptsFields({ system, setSystem, agentPrompt, setAgentPrompt, setPickerBusy, disabled, projectId }: Props) {
	return (
		<>
			<p className='mcp-note'>Select the prompt revisions the agent will use for this task.</p>
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
