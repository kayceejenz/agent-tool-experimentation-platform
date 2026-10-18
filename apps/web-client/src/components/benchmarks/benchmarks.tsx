'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ProjectSync } from '@/components/projects/project-provider';
import { projectRequest, projectWrite } from '@/lib/projects/client';
import type { Project } from '@/types/workspace';
import { pending, resultLabel } from './run-details';
import { RunBenchmarkDialog } from './run-dialog';
import type { Benchmark, BenchmarkPage, Capture } from '@/types/benchmark';

export function Benchmarks({ project }: { project: Project }) {
	const base = `/${project.id}`;
	const captureId = useSearchParams().get('capture');
	const [capture, setCapture] = useState<Capture | null>(null);
	const [question, setQuestion] = useState('');
	const [verified, setVerified] = useState(false);
	const [runTarget, setRunTarget] = useState<Benchmark | null>(null);
	const runButton = useRef<HTMLButtonElement | null>(null);
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
				'Example saved. Click Run to choose an agent and test the question.',
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
				{canWrite && (
					<Link
						className='button primary'
						href={`/projects/${project.id}/tools`}>
						Add new example
					</Link>
				)}
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
					<div className='benchmark-empty'>
						<h3>Start with one question</h3>
						<p>
							Open{' '}
							<Link
								href={`/projects/${project.id}/tools`}>
								Tools
							</Link>
							: test a tool, verify
							its result, then select{' '}
							<strong>
								Save as
								benchmark
							</strong>
							. You’ll then add the
							question the agent
							should answer.
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
											Result
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
												<td data-label='Result'>
													{item.agent_name && (
														<small>
															{
																item.agent_name
															}{' '}
															·
															v
															{
																item.agent_revision
															}
														</small>
													)}
													<span
														className={`benchmark-result ${item.score && item.score.arguments_correct && item.score.actual_count === 1 ? 'benchmark-match' : ''}`}>
														{resultLabel(
															item,
														)}
													</span>
													{item.execution_id &&
														!pending(
															item,
														) &&
														item.status !==
															'completed' && (
															<small>
																Run{' '}
																{
																	item.status
																}
																{item.termination_reason
																	? ` · ${item.termination_reason.replaceAll('_', ' ')}`
																	: ''}
																.
																Calls
																shown
																may
																be
																incomplete.
															</small>
														)}
												</td>
												<td data-label='Action'>
													<div className='benchmark-run-actions'>
														<button
															className='button primary'
															aria-label={`${item.execution_id ? 'Run again' : 'Run'}: ${item.input}`}
															disabled={
																!canWrite ||
																!!busy ||
																pending(
																	item,
																)
															}
															onClick={event => {
																runButton.current =
																	event.currentTarget;
																setRunTarget(
																	item,
																);
															}}>
															{busy ===
															item.id
																? 'Starting…'
																: pending(
																			item,
																	  )
																	? 'In progress'
																	: item.execution_id
																		? 'Run again'
																		: 'Run'}
														</button>
														{item.execution_id && (
															<Link
																className='button'
																aria-label={`View result: ${item.input}`}
																href={`/projects/${project.id}/benchmarks/runs/${item.execution_id}`}>
																View
																result
															</Link>
														)}
													</div>
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
			{runTarget && (
				<RunBenchmarkDialog
					projectId={project.id}
					item={runTarget}
					onClose={() => {
						setRunTarget(null);
						runButton.current?.focus();
					}}
					onStarted={() => {
						setNotice(
							'Run started. Open View result to follow its progress.',
						);
						setRefresh(n => n + 1);
					}}
				/>
			)}
		</>
	);
}
