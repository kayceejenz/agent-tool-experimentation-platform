'use client';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import type { Project } from '@/types/workspace';
import { projectRequest } from '@/lib/projects/client';

type Page = { items: Project[]; next_cursor: string | null };
type State = {
	selectedProject: Project | null;
	select: (project: Project) => void;
	projects: Project[];
	loading: boolean;
	error: string;
	more: boolean;
	load: (append?: boolean) => Promise<void>;
	upsert: (project: Project) => void;
};

const Context = createContext<State | null>(null);
export function ProjectProvider({ children }: { children: ReactNode }) {
	const [projects, setProjects] = useState<Project[]>([]);
	const [selectedProject, select] = useState<Project | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [cursor, setCursor] = useState<string | null>(null);
	const cursorRef = useRef<string | null>(null);
	const busy = useRef(false);
	const upsert = useCallback((project: Project) => {
		setProjects(items =>
			items.some(item => item.id === project.id)
				? items.map(item =>
						item.id === project.id
							? project
							: item,
					)
				: [project, ...items],
		);
		select(current =>
			current?.id === project.id ? project : current,
		);
	}, []);
	const load = useCallback(async (append = false) => {
		if (busy.current) return;
		busy.current = true;
		setLoading(true);
		setError('');
		try {
			const page = await projectRequest<Page>(
				append && cursorRef.current
					? `?cursor=${encodeURIComponent(cursorRef.current)}`
					: '',
			);
			setProjects(old =>
				append
					? [
							...new Map(
								[
									...old,
									...page.items,
								].map(
									project => [
										project.id,
										project,
									],
								),
							).values(),
						]
					: page.items,
			);
			cursorRef.current = page.next_cursor;
			setCursor(page.next_cursor);
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: 'Unable to load projects.',
			);
		} finally {
			busy.current = false;
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);
	return (
		<Context.Provider
			value={{
				selectedProject,
				select,
				projects,
				loading,
				error,
				more: Boolean(cursor),
				load,
				upsert,
			}}>
			{children}
		</Context.Provider>
	);
}

export function useProjects() {
	const context = useContext(Context);
	if (!context) throw new Error('ProjectProvider is required');
	return context;
}

export function ProjectSync({ project }: { project: Project }) {
	const { select } = useProjects();
	useEffect(() => {
		select(project);
	}, [project, select]);
	return null;
}
