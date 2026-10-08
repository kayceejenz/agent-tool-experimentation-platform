import { toolOperationRoute } from '@/lib/tools/routes';
export async function GET(_request: Request, context: { params: Promise<{ projectId: string; toolId: string; requestId: string }> }) {
    const { projectId, toolId, requestId } = await context.params;
    return toolOperationRoute(projectId, toolId, requestId);
}
