import { agentRoute } from '@/lib/agents/routes';
export async function GET(
	request: Request,
	context: {
		params: Promise<{ projectId: string; agentId: string; revision: string }>;
	},
) {
	const { projectId, agentId, revision } = await context.params;
	return agentRoute(request, projectId, agentId, true, revision);
}
