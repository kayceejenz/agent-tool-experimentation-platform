import { notFound } from 'next/navigation';
import { getProject } from '@/lib/projects/server';
import { ProjectOverview } from '@/components/workspace/workspace-views';

export default async function Page({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;

	const project = await getProject(projectId);
	if (!project) notFound();

	return <ProjectOverview project={project} />;
}
