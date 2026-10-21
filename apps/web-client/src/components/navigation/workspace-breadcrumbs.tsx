'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useProjects } from '@/components/projects/project-provider';
import { isSection, sections } from '@/lib/workspace';

type Crumb = { label: string; href: string };

export function WorkspaceBreadcrumbs() {
	const pathname = usePathname();
	const { projects, selectedProject } = useProjects();
	const parts = pathname.split('/').filter(Boolean);
	if (parts[0] !== 'projects') return null;
	const crumbs: Crumb[] = [{ label: 'Projects', href: '/projects' }];
	const projectId = parts[1];
	if (projectId === 'new')
		crumbs.push({ label: 'Create project', href: pathname });
	else if (projectId) {
		const project =
			selectedProject?.id === projectId
				? selectedProject
				: projects.find(item => item.id === projectId);
		const base = `/projects/${projectId}`;
		crumbs.push({ label: project?.name ?? 'Project', href: base });
		const section = parts[2];
		if (section && isSection(section))
			crumbs.push({
				label: sections[section].title,
				href: `${base}/${section}`,
			});
		if (section === 'agents' && parts[3]) {
			crumbs.push({
				label:
					parts[3] === 'new'
						? 'Create agent'
						: 'Configuration',
				href: `${base}/agents/${parts[3]}`,
			});
			if (parts[4] === 'playground')
				crumbs.push({
					label: 'Playground',
					href: pathname,
				});
		}
		if (section === 'benchmarks' && parts[3]) {
			crumbs.push({
				label:
					parts[3] === 'performance'
						? 'Agent performance'
						: parts[3] === 'runs'
							? 'Run details'
							: 'Manage benchmark',
				href: pathname,
			});
		}
	}
	return (
		<nav className='workspace-breadcrumb' aria-label='Breadcrumb'>
			<ol>
				{crumbs.map((crumb, index) => (
					<li key={crumb.href}>
						{index > 0 && (
							<span aria-hidden='true'>
								/
							</span>
						)}
						{index === crumbs.length - 1 ? (
							<span aria-current='page'>
								{crumb.label}
							</span>
						) : (
							<Link href={crumb.href}>
								{crumb.label}
							</Link>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}
