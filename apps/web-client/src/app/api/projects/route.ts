import { projectRoute } from '@/lib/projects/routes';

export async function GET(request: Request) {
	return projectRoute(request);
}

export async function POST(request: Request) {
	return projectRoute(request);
}
