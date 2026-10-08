'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
	ChevronDown,
	FileCode2,
	FolderKanban,
	Home,
	Server,
	Settings,
	Workflow,
	Wrench,
} from 'lucide-react';
import { useProjects } from '@/components/projects/project-provider';

const projectSections = [
	{ label: 'MCP Servers', slug: 'servers', icon: Server },
	{ label: 'Tools', slug: 'tools', icon: Wrench },
	{ label: 'Prompts', slug: 'prompts', icon: FileCode2 },
	{ label: 'Agents', slug: 'agents', icon: Workflow },
];

export function WorkspaceNavigation({
	onNavigate,
}: {
	onNavigate?: () => void;
}) {
	const pathname = usePathname();
	const { projects, selectedProject, loading, error, more } =
		useProjects();
	const router = useRouter();
	const pathParts = pathname.split('/');
	const project =
		pathParts[2] && pathParts[2] !== 'new'
			? selectedProject?.id === pathParts[2]
				? selectedProject
				: projects.find(
						item =>
							item.id ===
							pathParts[2],
					)
			: projects[0];
	const choices =
		project && !projects.some(item => item.id === project.id)
			? [project, ...projects]
			: projects;
	const base = project ? `/projects/${project.id}` : undefined;

	function navLink(
		href: string | undefined,
		label: string,
		Icon: typeof Home,
		exact = false,
	) {
		if (!href)
			return (
				<span
					key={label}
					className='nav-disabled'
					aria-disabled='true'>
					<Icon size={16} aria-hidden />
					<span>{label}</span>
				</span>
			);

		const active = exact
			? pathname === href
			: pathname === href || pathname.startsWith(`${href}/`);

		return (
			<Link
				key={href}
				href={href}
				className={active ? 'active' : ''}
				aria-current={active ? 'page' : undefined}
				onClick={onNavigate}>
				<Icon size={16} aria-hidden />
				<span>{label}</span>
			</Link>
		);
	}

	return (
		<nav
			className='structured-nav'
			aria-label='Workspace navigation'>
			{navLink('/projects', 'Projects', FolderKanban, true)}
			{project ? (
				<div className='nav-project-picker'>
					<label htmlFor='project-picker'>
						Project context
					</label>
					<div className='project-context-switcher'>
						<span className='project-switcher-icon'>
							{project.name[0]}
						</span>
						<span className='project-switcher-copy'>
							<small>
								Current project
							</small>
							<strong>
								{project.name}
							</strong>
						</span>
						<ChevronDown
							size={15}
							aria-hidden
						/>
						<select
							id='project-picker'
							aria-label='Switch project'
							value={project.id}
							onChange={event => {
								const section =
									pathParts[3];
								router.push(
									`/projects/${event.target.value}${section ? `/${section}` : ''}`,
								);
								onNavigate?.();
							}}>
							{choices.map(item => (
								<option
									key={
										item.id
									}
									value={
										item.id
									}>
									{
										item.name
									}
								</option>
							))}
						</select>
					</div>
				</div>
			) : (
				<p className='nav-guidance'>
					{loading
						? 'Loading projects…'
						: error
							? 'Projects are unavailable. Open Projects to retry.'
							: 'Select a project to access its tools and settings.'}
				</p>
			)}
			{more && (
				<Link
					className='nav-more'
					href='/projects'
					onClick={onNavigate}>
					Browse all projects
				</Link>
			)}
			<div className='nav-group'>
				{projectSections.map(item =>
					navLink(
						base
							? `${base}/${item.slug}`
							: undefined,
						item.label,
						item.icon,
					),
				)}
			</div>
			<div className='nav-group nav-settings'>
				{navLink(
					base ? `${base}/settings` : undefined,
					'Project settings',
					Settings,
				)}
			</div>
		</nav>
	);
}
