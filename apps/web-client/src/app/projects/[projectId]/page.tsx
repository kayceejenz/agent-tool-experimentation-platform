import { notFound } from 'next/navigation';
import { findProject } from '@/lib/workspace';
import { ProjectOverview } from '@/components/workspace/workspace-views';

export default async function Page({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;

	const project = findProject(projectId);
	if (!project) notFound();

	return <ProjectOverview project={project} />;
}
