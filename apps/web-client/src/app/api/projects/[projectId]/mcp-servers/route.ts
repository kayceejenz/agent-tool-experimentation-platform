import { mcpRoute } from '@/lib/mcp-servers/routes';

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
	return mcpRoute(request, (await context.params).projectId);
}

export async function POST(request: Request, context: Context) {
	return mcpRoute(request, (await context.params).projectId);
}
