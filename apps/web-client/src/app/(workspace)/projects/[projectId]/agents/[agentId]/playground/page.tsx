import { notFound } from 'next/navigation';
import { getProject } from '@/lib/projects/server';
import { AgentWorkspace } from '@/components/agents/agent-workspace';

export default async function Page({
	params,
}: {
	params: Promise<{ projectId: string; agentId: string }>;
}) {
	const { projectId, agentId } = await params;
	if (!/^[0-9a-f-]{36}$/i.test(agentId)) notFound();
	const project = await getProject(
		projectId,
		`agents/${agentId}/playground`,
	);
	return (
		<AgentWorkspace
			project={project}
			agentId={agentId}
			playground
		/>
	);
}
