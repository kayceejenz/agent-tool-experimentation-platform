import { mcpRoute } from '@/lib/mcp-servers/routes';

type Context = { params: Promise<{ projectId: string; serverId: string }> };

export async function POST(request: Request, context: Context) {
	const { projectId, serverId } = await context.params;
	return mcpRoute(request, projectId, serverId, 'discover');
}
