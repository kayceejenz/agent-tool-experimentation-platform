'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ProjectSync } from '@/components/projects/project-provider';
import { projectRequest, projectWrite } from '@/lib/projects/client';
import type { Project } from '@/types/workspace';
import { pending } from './run-details';
import type { BenchmarkPage, Capture } from '@/types/benchmark';

export function Benchmarks({ project }: { project: Project }) {
	const base = `/${project.id}`;
	const captureId = useSearchParams().get('capture');
	const [capture, setCapture] = useState<Capture | null>(null);
	const [question, setQuestion] = useState('');
	const [verified, setVerified] = useState(false);
	const [data, setData] = useState<BenchmarkPage | null>(null);
	const [refresh, setRefresh] = useState(0);
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	const requestIds = useRef(new Map<string, string>());
	const canWrite = project.role !== 'viewer';
	function requestId(key: string) {
		if (!requestIds.current.has(key))
			requestIds.current.set(key, crypto.randomUUID());
		return requestIds.current.get(key)!;
	}

	useEffect(() => {
		if (!captureId) return;
		const controller = new AbortController();
		void projectRequest<Capture>(
			`${base}/benchmarks/captures/${captureId}`,
			{ signal: controller.signal },
		)
			.then(value => {
				setCapture(value);
				setQuestion('');
				setVerified(false);
			})
			.catch(e => {
				if (!controller.signal.aborted)
					setError(e.message);
			});
		return () => controller.abort();
	}, [base, captureId]);

	useEffect(() => {
		const controller = new AbortController();
		void projectRequest<BenchmarkPage>(`${base}/benchmarks`, {
			signal: controller.signal,
		})
			.then(setData)
			.catch(e => {
				if (!controller.signal.aborted)
					setError(e.message);
			});
		return () => controller.abort();
	}, [base, refresh]);

	useEffect(() => {
		if (!data?.items.some(pending)) return;
		const timer = setTimeout(() => setRefresh(n => n + 1), 3000);
		return () => clearTimeout(timer);
	}, [data]);

	async function save(event: FormEvent) {
		event.preventDefault();
		if (
			!capture ||
			capture.id !== captureId ||
			!verified ||
			busy ||
			!canWrite
		)
			return;
		setBusy('save');
		setError('');
		setNotice('');
		try {
			await projectWrite(`${base}/benchmarks`, 'POST', {
				request_id: requestId(
					`save:${capture.id}:${question.trim()}`,
				),
				capture_id: capture.id,
				input: question.trim(),
			});
			setCapture(null);
			setQuestion('');
			setVerified(false);
			setNotice(
				'Example saved. Open Manage to run it against an agent.',
			);
			setRefresh(n => n + 1);
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to save.',
			);
		} finally {
			setBusy('');
		}
	}

	return (
		<>
			<ProjectSync project={project} />
			<header className='workspace-header'>
				<div>
					<h1>Benchmarks</h1>
					<p>
						Compare your agent’s tool calls
						with examples you have checked
						yourself.
					</p>
				</div>
				<div className='benchmark-toolbar-actions'>
					<Link
						className='button'
						href={`/projects/${project.id}/benchmarks/performance`}>
						Agent performance
					</Link>
					{canWrite && (
						<Link
							className='button primary'
							href={`/projects/${project.id}/tools`}>
							Add new example
						</Link>
					)}
				</div>
			</header>
			{error && (
				<p role='alert' className='project-error'>
					{error}
				</p>
			)}
			{notice && <p role='status'>{notice}</p>}
			{capture && capture.id === captureId && canWrite && (
				<section className='panel simple-benchmark-panel'>
					<h2>
						What question should this tool
						call answer?
					</h2>
					<p>
						Write the question you will give
						the agent. Your manual test
						provides the expected tool and
						inputs.
					</p>
					<form
						className='project-form'
						onSubmit={save}>
						<label htmlFor='benchmark-question'>
							Question for the agent
						</label>
						<textarea
							id='benchmark-question'
							value={question}
							onChange={e =>
								setQuestion(
									e.target
										.value,
								)
							}
							maxLength={16000}
							required
							disabled={!!busy}
							rows={3}
							placeholder='For example: What were our sales in September 2026?'
							aria-describedby='benchmark-question-help'
						/>
						<small id='benchmark-question-help'>
							Include the details used
							in your test, such as
							the month, region or
							customer.
						</small>
						<p>
							<strong>
								Expected tool:
							</strong>{' '}
							{capture.server_name} /{' '}
							{capture.tool_name}
						</p>
						<details>
							<summary>
								Review your
								manual test
							</summary>
							<h3>Inputs you sent</h3>
							<pre>
								{JSON.stringify(
									capture.arguments,
									null,
									2,
								)}
							</pre>
							<h3>
								Result you
								received
							</h3>
							<pre>
								{JSON.stringify(
									capture.result,
									null,
									2,
								)}
							</pre>
						</details>
						<label className='benchmark-check'>
							<input
								type='checkbox'
								checked={
									verified
								}
								onChange={e =>
									setVerified(
										e
											.target
											.checked,
									)
								}
								disabled={
									!!busy
								}
								required
							/>
							I checked that this call
							correctly answers the
							question.
						</label>
						<button
							className='button primary'
							disabled={
								!!busy ||
								!verified ||
								!question.trim()
							}>
							{busy === 'save'
								? 'Saving…'
								: 'Save example'}
						</button>
					</form>
				</section>
			)}
			<section
				className='panel simple-benchmark-panel'
				aria-label='Saved questions'>
				<div className='prompt-toolbar'>
					<h2>Saved questions</h2>
					<button
						className='button'
						disabled={!!busy}
						onClick={() => {
							setError('');
							setRefresh(n => n + 1);
						}}>
						Refresh
					</button>
				</div>
				{!data ? (
					<p role='status'>Loading examples…</p>
				) : !data.items.length ? (
					<div className='empty-state'>
						<h2>No benchmarks yet</h2>
						<p>
							Create a benchmark from
							a verified tool test to
							check your agent’s tool
							use.
						</p>
					</div>
				) : (
					<>
						{!canWrite && (
							<p>
								You have
								read-only
								access. You can
								view results but
								cannot start a
								run.
							</p>
						)}
						<div className='tool-table-wrap'>
							<table className='tool-table benchmark-table'>
								<thead>
									<tr>
										<th scope='col'>
											Question
										</th>
										<th scope='col'>
											Expected
											tool
										</th>
										<th scope='col'>
											Action
										</th>
									</tr>
								</thead>
								<tbody>
									{data.items.map(
										item => (
											<tr
												key={
													item.id
												}>
												<td data-label='Question'>
													{
														item.input
													}
												</td>
												<td data-label='Expected tool'>
													<strong>
														{
															item.tool_name
														}
													</strong>
													<small>
														{
															item.server_name
														}
													</small>
												</td>
												<td data-label='Action'>
													<Link
														className='button'
														aria-label={`Manage: ${item.input}`}
														href={`/projects/${project.id}/benchmarks/${item.id}`}>
														Manage
													</Link>
												</td>
											</tr>
										),
									)}
								</tbody>
							</table>
						</div>
					</>
				)}
			</section>
		</>
	);
}
