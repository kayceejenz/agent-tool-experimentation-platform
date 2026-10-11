import { evaluationRoute } from '@/lib/agents/execution-routes';
type Context = { params: Promise<{ projectId: string; executionId: string }> };
export async function GET(request: Request, context: Context) {
    const { projectId, executionId } = await context.params;
    return evaluationRoute(request, projectId, executionId);
}
export async function POST(request: Request, context: Context) {
    const { projectId, executionId } = await context.params;
    return evaluationRoute(request, projectId, executionId);
}
