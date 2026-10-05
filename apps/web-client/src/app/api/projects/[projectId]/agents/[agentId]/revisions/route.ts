import { agentRoute } from '@/lib/agents/routes';
export async function GET(
	request: Request,
	context: { params: Promise<{ projectId: string; agentId: string }> },
) {
	const { projectId, agentId } = await context.params;
	return agentRoute(request, projectId, agentId, true);
}
export async function POST(
	request: Request,
	context: { params: Promise<{ projectId: string; agentId: string }> },
) {
	const { projectId, agentId } = await context.params;
	return agentRoute(request, projectId, agentId, true);
}
