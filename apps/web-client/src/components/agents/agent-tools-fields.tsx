'use client';
import type { useAgentEditor } from '@/components/agents/use-agent-editor';
import { ToolPicker } from './tool-picker';

export function AgentToolsFields({ tools, setTools, disabled, projectId }: Pick<ReturnType<typeof useAgentEditor>, 'tools' | 'setTools' | 'disabled'> & { projectId: string }) {
	return (
		<ToolPicker
			projectId={projectId}
			value={tools}
			disabled={disabled}
			onChange={setTools}
		/>
	);
}
