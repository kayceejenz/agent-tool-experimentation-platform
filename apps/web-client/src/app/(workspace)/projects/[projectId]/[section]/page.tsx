import { notFound } from 'next/navigation';
import { isSection } from '@/lib/workspace';
import { getProject } from '@/lib/projects/server';
import { SectionView } from '@/components/workspace/workspace-views';

export default async function Page({
	params,
}: {
	params: Promise<{ projectId: string; section: string }>;
}) {
	const { projectId, section } = await params;

	const project = await getProject(projectId, section);

	if (!project || !isSection(section)) notFound();

	return <SectionView project={project} section={section} />;
}
