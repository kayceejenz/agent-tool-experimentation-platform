import { executionRoute } from '@/lib/agents/execution-routes';
export async function GET(request: Request, context: { params: Promise<{ projectId: string; executionId: string }> }) {
 const { projectId, executionId } = await context.params;
 return executionRoute(request, projectId, executionId, 'detail');
}
