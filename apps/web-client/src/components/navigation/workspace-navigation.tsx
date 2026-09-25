'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
	Bot,
	ChevronDown,
	FileCode2,
	FlaskConical,
	FolderKanban,
	Gauge,
	Home,
	PlayCircle,
	Server,
	Settings,
	Wrench,
	Workflow,
} from 'lucide-react';
import { projects } from '@/lib/workspace';

const groups = [
	{
		label: 'Integrations',
		items: [
			{ label: 'MCP Servers', slug: 'servers', icon: Server },
			{ label: 'Tools', slug: 'tools', icon: Wrench },
		],
	},
	{
		label: 'Development',
		items: [
			{
				label: 'Experiments',
				slug: 'experiments',
				icon: FlaskConical,
			},
			{
				label: 'Benchmarks',
				slug: 'benchmarks',
				icon: Gauge,
			},
		],
	},
	{
		label: 'AI applications',
		items: [
			{ label: 'Prompts', slug: 'prompts', icon: FileCode2 },
			{ label: 'Agents', slug: 'agents', icon: Workflow },
			{ label: 'Assistants', slug: 'assistants', icon: Bot },
		],
	},
	{
		label: 'Operations',
		items: [{ label: 'Runs', slug: 'runs', icon: PlayCircle }],
	},
];
export function WorkspaceNavigation({
	onNavigate,
}: {
	onNavigate?: () => void;
}) {
	const pathname = usePathname();
	const router = useRouter();
	const pathParts = pathname.split('/');
	const project =
		projects.find(item => item.id === pathParts[2]) ?? projects[0];
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
			<div className='nav-group'>
				<span className='nav-group-label'>
					Workspace
				</span>
				{navLink('/', 'Overview', Home, true)}
				{navLink(
					'/projects',
					'Projects',
					FolderKanban,
					true,
				)}
			</div>
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
							{projects.map(item => (
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
					Select a project to access its tools and
					settings.
				</p>
			)}
			{groups.map(group => (
				<div className='nav-group' key={group.label}>
					<span className='nav-group-label'>
						{group.label}
					</span>
					{group.items.map(item =>
						navLink(
							base
								? `${base}/${item.slug}`
								: undefined,
							item.label,
							item.icon,
						),
					)}
				</div>
			))}
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
