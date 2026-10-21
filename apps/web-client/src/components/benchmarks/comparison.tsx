'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProjectSync } from '@/components/projects/project-provider';
import { projectRequest } from '@/lib/projects/client';
import { RunBenchmarkDialog } from './run-dialog';
import { pending } from './run-details';
import styles from './comparison.module.css';
import { StructuredPayload } from '@/components/content/structured-payload';
import type { Benchmark } from '@/types/benchmark';
import type { Project } from '@/types/workspace';

type Run = Benchmark & {
	model_settings: { provider: string; model: string };
	latency_ms: number | null;
};
type History = { benchmark: Benchmark; runs: Run[] };
const percent = (value: number | null) =>
	value === null ? '—' : `${value.toFixed(1)}%`;

export function BenchmarkComparison({
	project,
	benchmarkId,
}: {
	project: Project;
	benchmarkId: string;
}) {
	const router = useRouter();
	const [deleting, setDeleting] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const deleteDialog = useRef<HTMLDialogElement>(null);
	const deleteButton = useRef<HTMLButtonElement>(null);
	const [deleteError, setDeleteError] = useState('');
	useEffect(() => {
		if (confirmDelete) deleteDialog.current?.showModal();
		else deleteDialog.current?.close();
	}, [confirmDelete]);
	const [data, setData] = useState<History | null>(null);
	const [error, setError] = useState('');
	const [refresh, setRefresh] = useState(0);
	const [showRun, setShowRun] = useState(false);
	const runButton = useRef<HTMLButtonElement>(null);
	const [notice, setNotice] = useState('');
	useEffect(() => {
		const controller = new AbortController();
		void projectRequest<History>(
			`/${project.id}/benchmarks/${benchmarkId}/runs`,
			{ signal: controller.signal },
		)
			.then(value => {
				setData(value);
				setError('');
			})
			.catch(e => {
				if (!controller.signal.aborted)
					setError(e.message);
			});
		return () => controller.abort();
	}, [project.id, benchmarkId, refresh]);
	useEffect(() => {
		if (!data?.runs.some(pending)) return;
		const timer = setTimeout(() => setRefresh(n => n + 1), 3000);
		return () => clearTimeout(timer);
	}, [data]);
	async function deleteQuestion() {
		if (deleting) return;
		setDeleting(true);
		setDeleteError('');
		try {
			await projectRequest(
				`/${project.id}/benchmarks/${benchmarkId}`,
				{ method: 'DELETE' },
			);
			router.push(`/projects/${project.id}/benchmarks`);
		} catch (e) {
			setDeleteError(
				e instanceof Error
					? e.message
					: 'Unable to delete question.',
			);
			setDeleting(false);
		}
	}
	return (
		<>
			<ProjectSync project={project} />
			<header className='workspace-header'>
				<div>
					<Link
						href={`/projects/${project.id}/benchmarks`}>
						← Back to benchmarks
					</Link>
					<h1>Manage benchmark</h1>
				</div>
				{project.role !== 'viewer' && (
					<div className={styles.actions}>
						<button
							ref={deleteButton}
							className={`button ${styles.deleteButton}`}
							disabled={
								!data ||
								deleting
							}
							onClick={() => {
								setDeleteError(
									'',
								);
								setConfirmDelete(
									true,
								);
							}}>
							Delete question
						</button>
						<button
							ref={runButton}
							className='button primary'
							disabled={
								!data ||
								deleting
							}
							onClick={() =>
								setShowRun(true)
							}>
							Run
						</button>
					</div>
				)}
			</header>
			{notice && <p role='status'>{notice}</p>}
			{error && (
				<p role='alert' className='project-error'>
					{error}
				</p>
			)}
			{data && (
				<section
					className={`panel simple-benchmark-panel ${styles.details}`}
					aria-label='Benchmark details'>
					<h2>Question</h2>
					<p className={styles.question}>
						{data.benchmark.input}
					</p>
					<dl className={styles.metadata}>
						<div>
							<dt>Expected tool</dt>
							<dd>
								{
									data
										.benchmark
										.tool_name
								}
							</dd>
						</div>
						<div>
							<dt>MCP server</dt>
							<dd>
								{
									data
										.benchmark
										.server_name
								}
							</dd>
						</div>
						<div>
							<dt>Total runs</dt>
							<dd>
								{
									data
										.runs
										.length
								}
							</dd>
						</div>
					</dl>
					<details>
						<summary>
							Expected arguments
						</summary>
						<StructuredPayload
							value={
								data.benchmark
									.arguments
							}
							label='Expected arguments'
						/>
					</details>
				</section>
			)}
			<section className='panel simple-benchmark-panel'>
				<div className='prompt-toolbar'>
					<h2>All runs</h2>
					<button
						className='button'
						onClick={() =>
							setRefresh(n => n + 1)
						}>
						Refresh
					</button>
				</div>
				{!data ? (
					<p role='status'>Loading runs…</p>
				) : !data.runs.length ? (
					<p>No runs yet.</p>
				) : (
					<div
						className={`tool-table-wrap ${styles.wrap}`}
						role='region'
						aria-label='Run comparison'
						tabIndex={0}>
						<table
							className={`tool-table ${styles.table}`}>
							<thead>
								<tr>
									{[
										'Agent',
										'Model',
										'Latency',
										'Status',
										'Tool precision',
										'Tool recall',
										'Argument accuracy',
										'Action',
									].map(
										label => (
											<th
												scope='col'
												key={
													label
												}
												className={
													[
														'Tool precision',
														'Tool recall',
														'Argument accuracy',
													].includes(
														label,
													)
														? styles.score
														: undefined
												}>
												{
													label
												}
											</th>
										),
									)}
								</tr>
							</thead>
							<tbody>
								{data.runs.map(
									run => {
										const score =
											run.score;
										return (
											<tr
												key={
													run.execution_id
												}>
												<td data-label='Agent'>
													<strong>
														{
															run.agent_name
														}
													</strong>
													<small>
														v
														{
															run.agent_revision
														}
													</small>
												</td>
												<td data-label='Model'>
													{run
														.model_settings
														?.model ??
														'Unknown'}
													<small>
														{
															run
																.model_settings
																?.provider
														}
													</small>
												</td>
												<td data-label='Latency'>
													{run.latency_ms ==
													null
														? '—'
														: run.latency_ms <
															  1000
															? `${Math.round(run.latency_ms)} ms`
															: `${(run.latency_ms / 1000).toFixed(2)} s`}
												</td>
												<td data-label='Status'>
													<span
														className={
															styles.status
														}>
														{run.status?.replaceAll(
															'_',
															' ',
														)}
													</span>
												</td>
												<td
													data-label='Tool precision'
													className={
														styles.score
													}>
													{percent(
														score &&
															score.actual_count
															? (100 *
																	score.matched_count) /
																	score.actual_count
															: null,
													)}
												</td>
												<td
													data-label='Tool recall'
													className={
														styles.score
													}>
													{percent(
														score
															? 100 *
																	score.matched_count
															: null,
													)}
												</td>
												<td
													data-label='Argument accuracy'
													className={
														styles.score
													}>
													{percent(
														score?.argument_accuracy ??
															null,
													)}
												</td>
												<td data-label='Action'>
													<Link
														className='button'
														href={`/projects/${project.id}/benchmarks/runs/${run.execution_id}`}>
														View
														run
													</Link>
												</td>
											</tr>
										);
									},
								)}
							</tbody>
						</table>
					</div>
				)}
			</section>
			<dialog
				ref={deleteDialog}
				className='benchmark-run-dialog'
				aria-labelledby='delete-question-title'
				aria-describedby='delete-question-description'
				onCancel={event => {
					if (deleting) event.preventDefault();
					else setConfirmDelete(false);
				}}
				onClose={() => {
					setConfirmDelete(false);
					deleteButton.current?.focus();
				}}>
				<h2 id='delete-question-title'>
					Delete benchmark question?
				</h2>
				<p id='delete-question-description'>
					This question will be removed from your
					benchmark list. Existing agent
					executions will be kept.
				</p>
				{deleteError && (
					<p
						role='alert'
						className='project-error'>
						{deleteError}
					</p>
				)}
				<div className={styles.actions}>
					<button
						className='button'
						autoFocus
						disabled={deleting}
						onClick={() =>
							setConfirmDelete(false)
						}>
						Cancel
					</button>
					<button
						className={`button ${styles.deleteButton}`}
						disabled={deleting}
						onClick={deleteQuestion}>
						{deleting
							? 'Deleting…'
							: 'Confirm delete'}
					</button>
				</div>
			</dialog>
			{showRun && data && (
				<RunBenchmarkDialog
					projectId={project.id}
					item={data.benchmark}
					onClose={() => {
						setShowRun(false);
						runButton.current?.focus();
					}}
					onStarted={() => {
						setNotice('Run started.');
						setRefresh(n => n + 1);
					}}
				/>
			)}
		</>
	);
}
