import { executionRoute } from '@/lib/agents/execution-routes';
export async function GET(request: Request, context: { params: Promise<{ projectId: string; agentId: string }> }) {
 const { projectId, agentId } = await context.params;
 return executionRoute(request, projectId, agentId, 'agent');
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string; agentId: string }> }) {
 const { projectId, agentId } = await context.params;
 return executionRoute(request, projectId, agentId, 'agent');
}
