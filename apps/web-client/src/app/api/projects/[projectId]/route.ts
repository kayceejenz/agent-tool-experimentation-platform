import { projectRoute } from '@/lib/projects/routes';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(request: Request, context: Context) { return projectRoute(request, (await context.params).projectId); }
export async function PATCH(request: Request, context: Context) { return projectRoute(request, (await context.params).projectId); }
