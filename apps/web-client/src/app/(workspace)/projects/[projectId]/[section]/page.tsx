import { notFound } from 'next/navigation';
import { findProject, isSection } from '@/lib/workspace';
import { SectionView } from '@/components/workspace/workspace-views';

export default async function Page({
	params,
}: {
	params: Promise<{ projectId: string; section: string }>;
}) {
	const { projectId, section } = await params;

	const project = findProject(projectId);

	if (!project || !isSection(section)) notFound();

	return <SectionView project={project} section={section} />;
}
