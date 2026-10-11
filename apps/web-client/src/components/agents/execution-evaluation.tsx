'use client';
import { useEffect, useState } from 'react';
import {
	CheckCircle2,
	AlertTriangle,
	CircleHelp,
	Clock3,
	ClipboardCheck,
	RotateCw,
} from 'lucide-react';
import { projectRequest, projectWrite } from '@/lib/projects/client';
import { isCancelled } from '@/lib/http/response';
import type { ExecutionSpan } from '@/types/execution';

type Finding = {
	name: string;
	status?: string;
	reason: string;
	evidence_refs: string[];
};
type Evaluation = {
	id: string;
	attempt: number;
	status: string;
	error_code: string | null;
	profile: {
		model: string;
		rubric_version: number;
		prompt: { revision: number } | null;
	};
	metrics: {
		model_turns: number;
		tool_calls: number;
		elapsed_ms: number | null;
		usage_counts: {
			input_count: number;
			output_count: number;
			missing_usage_turns: number;
		};
		assertions: { name: string; value: string; status: string }[];
	} | null;
	usage: {
		input_count: number | null;
		output_count: number | null;
	} | null;
	report: {
		task_outcome: string;
		overall_verdict: string;
		requirements: Finding[];
		checks: Finding[];
		critical_failures: Finding[];
		limitations: string[];
	} | null;
};
const labels: Record<string, string> = {
	task_completion: 'Task completion',
	tool_selection: 'Tool selection',
	tool_inputs: 'Tool inputs',
	output_use: 'Use of results',
	answer_quality: 'Answer quality',
	efficiency: 'Efficiency',
	write_handling: 'Write handling',
	pass: 'Passed',
	partial: 'Partial',
	fail: 'Failed',
	unknown: 'Unknown',
	not_applicable: 'Not applicable',
	completed: 'Completed',
	blocked: 'Blocked',
	failed: 'Failed',
	queued: 'Queued',
	running: 'Evaluating',
};
const label = (value: string) => labels[value] ?? value.replaceAll('_', ' ');
const number = (value: number | null | undefined) =>
	value == null ? '—' : value.toLocaleString();

function VerdictBadge({ value }: { value: string }) {
	const Icon =
		value === 'pass' || value === 'completed'
			? CheckCircle2
			: value === 'fail' ||
				  value === 'failed' ||
				  value === 'partial'
				? AlertTriangle
				: value === 'queued' || value === 'running'
					? Clock3
					: CircleHelp;
	return (
		<span className={`evaluation-badge verdict-${value}`}>
			<Icon size={13} aria-hidden='true' />
			{label(value)}
		</span>
	);
}

type Page = { items: Evaluation[]; next_offset: number | null };

export function ExecutionEvaluation({
	path,
	canEvaluate,
}: {
	path: string;
	canEvaluate: boolean;
}) {
	const [page, setPage] = useState<Page | null>(null);
	const [error, setError] = useState('');
	const [refresh, setRefresh] = useState(0);
	const [busy, setBusy] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		async function load() {
			try {
				const value = await projectRequest<Page>(
					`${path}/evaluations`,
					{ signal: controller.signal },
				);
				if (controller.signal.aborted) return;
				setPage(value);
				setError('');
				if (
					value.items.some(item =>
						['queued', 'running'].includes(
							item.status,
						),
					)
				)
					timer = setTimeout(
						() => void load(),
						3000,
					);
			} catch (e) {
				if (!isCancelled(e))
					setError(
						e instanceof Error
							? e.message
							: 'Unable to load evaluation.',
					);
			}
		}
		void load();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [path, refresh]);
	async function reevaluate() {
		setBusy(true);
		setError('');
		try {
			await projectWrite(`${path}/evaluations`, 'POST', {
				request_id: crypto.randomUUID(),
			});
			setSelected(null);
			setRefresh(n => n + 1);
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to evaluate.',
			);
		} finally {
			setBusy(false);
		}
	}
	async function older() {
		if (page?.next_offset == null) return;
		setBusy(true);
		try {
			const value = await projectRequest<Page>(
				`${path}/evaluations?offset=${page.next_offset}`,
			);
			setPage(previous =>
				previous
					? {
							items: [
								...previous.items,
								...value.items,
							],
							next_offset:
								value.next_offset,
						}
					: value,
			);
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to load evaluations.',
			);
		} finally {
			setBusy(false);
		}
	}
	const evaluation =
		page?.items.find(item => item.id === selected) ??
		page?.items[0];
	const pending = page?.items.some(item =>
		['queued', 'running'].includes(item.status),
	);
	const report = evaluation?.report;
	const issues =
		report?.checks.filter(check =>
			['fail', 'partial'].includes(check.status ?? ''),
		) ?? [];
	return (
		<details className='playground-details evaluation-panel'>
			<summary>
				<ClipboardCheck size={16} aria-hidden='true' />
				Evaluation
				<span className='evaluation-summary-status'>
					{report && (
						<small>
							{report
								.critical_failures
								.length
								? `${report.critical_failures.length} critical ${report.critical_failures.length === 1 ? 'issue' : 'issues'}`
								: issues.length
									? `${issues.length} ${issues.length === 1 ? 'check needs' : 'checks need'} attention`
									: report.overall_verdict ===
										  'pass'
										? 'All checks passed'
										: 'Review findings'}
						</small>
					)}
					{evaluation ? (
						<VerdictBadge
							value={
								report?.overall_verdict ??
								evaluation.status
							}
						/>
					) : (
						<small>
							{error
								? 'Unavailable'
								: page
									? 'No evaluation yet'
									: 'Loading…'}
						</small>
					)}
				</span>
			</summary>
			<div className='playground-detail-content'>
				<div className='evaluation-toolbar'>
					<p>
						How well the agent fulfilled
						this request
					</p>
					{canEvaluate && (
						<button
							type='button'
							className='button evaluation-run-button'
							disabled={
								busy ||
								pending ||
								!page
							}
							onClick={() =>
								void reevaluate()
							}>
							<RotateCw
								size={14}
								aria-hidden='true'
							/>
							{busy
								? 'Queuing…'
								: evaluation
									? 'Evaluate again'
									: 'Evaluate request'}
						</button>
					)}
				</div>
				{error && (
					<div
						className='evaluation-notice'
						role='alert'>
						<p>{error}</p>
						<button
							type='button'
							className='button'
							onClick={() =>
								setRefresh(
									n =>
										n +
										1,
								)
							}>
							Try again
						</button>
					</div>
				)}
				{!page && !error && (
					<p
						className='evaluation-empty'
						role='status'>
						Loading evaluation…
					</p>
				)}
				{page && !evaluation && (
					<div className='evaluation-empty'>
						<CircleHelp
							size={24}
							aria-hidden='true'
						/>
						<h4>No evaluation yet</h4>
						<p>
							Evaluate this request to
							review the agent’s tool
							use and answer.
							Automatic evaluation can
							be enabled in the
							agent’s Evaluation
							settings.
						</p>
					</div>
				)}
				{evaluation &&
					!report &&
					!evaluation.error_code && (
						<div
							className='evaluation-empty'
							role='status'>
							<Clock3
								size={24}
								aria-hidden='true'
							/>
							<h4>
								{evaluation.status ===
								'queued'
									? 'Waiting for evaluation'
									: 'Reviewing this request'}
							</h4>
							<p>
								The report will
								appear here when
								it is ready.
							</p>
						</div>
					)}
				{evaluation?.error_code && (
					<div
						className='evaluation-notice'
						role='alert'>
						<AlertTriangle
							size={18}
							aria-hidden='true'
						/>
						<div>
							<strong>
								Evaluation could
								not finish
							</strong>
							<p>
								{evaluation.error_code ===
								'provider_not_configured'
									? 'The evaluator needs to be configured before this request can be reviewed.'
									: evaluation.error_code ===
										  'provider_quota'
										? 'The model provider has no available quota. Check the provider account before retrying.'
										: evaluation.error_code ===
											  'evaluation_output_limit'
											? 'The evaluator reached its output limit before finishing the report. Keep the evaluation rubric concise before retrying.'
											: evaluation.error_code ===
												  'evaluation_timeout'
												? 'The evaluator exceeded its time limit. Try again.'
												: evaluation.error_code ===
													  'evaluation_refused'
													? 'The model provider declined to produce this evaluation. Review the evaluation instructions.'
													: evaluation.error_code ===
														  'invalid_evaluation_report'
														? 'The review could not be validated. Try again or review the evaluation instructions.'
														: 'The review was interrupted or the evaluator could not respond. Try again when it is available.'}
							</p>
						</div>
					</div>
				)}
				{evaluation && (
					<>
						{report && (
							<>
								<div className='evaluation-overview'>
									<div>
										<span className='evaluation-eyebrow'>
											Task
											outcome
										</span>
										<strong>
											{label(
												report.task_outcome,
											)}
										</strong>
										<small>
											Did
											the
											request
											get
											fulfilled?
										</small>
									</div>
									<div>
										<span className='evaluation-eyebrow'>
											Quality
											verdict
										</span>
										<VerdictBadge
											value={
												report.overall_verdict
											}
										/>
										<small>
											{issues.length
												? `${issues.length} ${issues.length === 1 ? 'check needs' : 'checks need'} attention`
												: report.overall_verdict ===
													  'pass'
													? 'All applicable checks passed'
													: 'Review the findings below'}
										</small>
									</div>
								</div>
								{report
									.critical_failures
									.length >
									0 && (
									<section className='evaluation-critical'>
										<h4>
											<AlertTriangle
												size={
													16
												}
												aria-hidden='true'
											/>
											Critical
											failures
										</h4>
										{report.critical_failures.map(
											(
												finding,
												i,
											) => (
												<FindingDetails
													key={
														i
													}
													finding={
														finding
													}
													path={
														path
													}
													initiallyOpen
												/>
											),
										)}
									</section>
								)}
								{issues.length >
									0 && (
									<section className='evaluation-group'>
										<h4>
											Needs
											attention{' '}
											<span>
												{
													issues.length
												}
											</span>
										</h4>
										{issues.map(
											finding => (
												<FindingDetails
													key={
														finding.name
													}
													finding={
														finding
													}
													path={
														path
													}
												/>
											),
										)}
									</section>
								)}
								<details className='evaluation-group evaluation-section'>
									<summary>
										All
										quality
										checks{' '}
										<span>
											{
												report
													.checks
													.length
											}
										</span>
									</summary>
									{report.checks.map(
										finding => (
											<FindingDetails
												key={
													finding.name
												}
												finding={
													finding
												}
												path={
													path
												}
											/>
										),
									)}
								</details>
								<details className='evaluation-group evaluation-section'>
									<summary>
										Request
										requirements{' '}
										<span>
											{
												report
													.requirements
													.length
											}
										</span>
									</summary>
									{report
										.requirements
										.length ? (
										report.requirements.map(
											(
												finding,
												i,
											) => (
												<FindingDetails
													key={
														i
													}
													finding={
														finding
													}
													path={
														path
													}
												/>
											),
										)
									) : (
										<p className='evaluation-muted'>
											There
											was
											not
											enough
											evidence
											to
											assess
											individual
											requirements.
										</p>
									)}
								</details>
								{report
									.limitations
									.length >
									0 && (
									<aside className='evaluation-limitations'>
										<h4>
											<CircleHelp
												size={
													15
												}
												aria-hidden='true'
											/>
											Limits
											of
											this
											review
										</h4>
										<ul>
											{report.limitations.map(
												(
													text,
													i,
												) => (
													<li
														key={
															i
														}>
														{
															text
														}
													</li>
												),
											)}
										</ul>
									</aside>
								)}
							</>
						)}
						{evaluation.metrics && (
							<details className='evaluation-usage'>
								<summary>
									Usage
									and
									benchmark
									checks
								</summary>
								<div className='evaluation-metrics'>
									<div>
										<span>
											Tool
											calls
										</span>
										<strong>
											{number(
												evaluation
													.metrics
													.tool_calls,
											)}
										</strong>
									</div>
									<div>
										<span>
											Model
											turns
										</span>
										<strong>
											{number(
												evaluation
													.metrics
													.model_turns,
											)}
										</strong>
									</div>
									<div>
										<span>
											Execution
											time
										</span>
										<strong>
											{evaluation
												.metrics
												.elapsed_ms ==
											null
												? '—'
												: `${(evaluation.metrics.elapsed_ms / 1000).toFixed(1)}s`}
										</strong>
									</div>
								</div>
								<table className='evaluation-token-table'>
									<caption>
										Token
										usage
									</caption>
									<thead>
										<tr>
											<th scope='col'>
												Source
											</th>
											<th scope='col'>
												Input
											</th>
											<th scope='col'>
												Output
											</th>
										</tr>
									</thead>
									<tbody>
										<tr>
											<th scope='row'>
												Agent
											</th>
											<td>
												{number(
													evaluation
														.metrics
														.usage_counts
														.input_count,
												)}
											</td>
											<td>
												{number(
													evaluation
														.metrics
														.usage_counts
														.output_count,
												)}
											</td>
										</tr>
										<tr>
											<th scope='row'>
												Evaluator
											</th>
											<td>
												{number(
													evaluation
														.usage
														?.input_count,
												)}
											</td>
											<td>
												{number(
													evaluation
														.usage
														?.output_count,
												)}
											</td>
										</tr>
									</tbody>
								</table>
								{evaluation
									.metrics
									.usage_counts
									.missing_usage_turns >
									0 && (
									<p className='evaluation-muted'>
										Agent
										usage
										is
										incomplete:{' '}
										{
											evaluation
												.metrics
												.usage_counts
												.missing_usage_turns
										}{' '}
										turns
										did
										not
										report
										token
										counts.
									</p>
								)}
								{evaluation
									.metrics
									.assertions
									.length >
									0 && (
									<div className='evaluation-assertions'>
										<h4>
											Benchmark
											assertions
										</h4>
										{evaluation.metrics.assertions.map(
											(
												assertion,
												i,
											) => (
												<div
													key={
														i
													}>
													<span>
														{label(
															assertion.name,
														)}
														<small>
															{
																assertion.value
															}
														</small>
													</span>
													<VerdictBadge
														value={
															assertion.status
														}
													/>
												</div>
											),
										)}
									</div>
								)}
							</details>
						)}
						<div className='evaluation-provenance'>
							<span>
								{
									evaluation
										.profile
										.model
								}{' '}
								· rubric v
								{
									evaluation
										.profile
										.rubric_version
								}
								{evaluation
									.profile
									.prompt &&
									` · prompt v${evaluation.profile.prompt.revision}`}
							</span>
							{page &&
							page.items.length >
								1 ? (
								<label>
									<span className='evaluation-history-label'>
										Evaluation
										history
									</span>
									<select
										value={
											evaluation.id
										}
										onChange={e =>
											setSelected(
												e
													.target
													.value,
											)
										}>
										{page.items.map(
											item => (
												<option
													key={
														item.id
													}
													value={
														item.id
													}>
													Attempt{' '}
													{
														item.attempt
													}{' '}
													·{' '}
													{label(
														item
															.report
															?.overall_verdict ??
															item.status,
													)}
												</option>
											),
										)}
									</select>
								</label>
							) : (
								<span>
									Attempt{' '}
									{
										evaluation.attempt
									}
								</span>
							)}
						</div>
					</>
				)}
				{page?.next_offset != null && (
					<button
						className='button'
						type='button'
						disabled={busy}
						onClick={() => void older()}>
						Load older evaluations
					</button>
				)}
			</div>
		</details>
	);
}

function FindingDetails({
	finding,
	path,
	initiallyOpen = false,
}: {
	finding: Finding;
	path: string;
	initiallyOpen?: boolean;
}) {
	return (
		<details
			className='evaluation-finding'
			open={initiallyOpen || undefined}>
			<summary>
				<strong>{label(finding.name)}</strong>
				{finding.status && (
					<VerdictBadge value={finding.status} />
				)}
			</summary>
			<div className='evaluation-finding-content'>
				<p>{finding.reason}</p>
				{finding.evidence_refs.map(ref =>
					ref === 'request' ||
					ref === 'final_answer' ? (
						<a
							className='evaluation-source'
							key={ref}
							href={`#execution-${ref === 'request' ? 'task' : 'answer'}-${path.split('/').at(-1)}`}>
							{ref === 'request'
								? 'View your task'
								: 'View final answer'}
						</a>
					) : (
						<Evidence
							key={ref}
							path={path}
							spanId={ref}
						/>
					),
				)}
			</div>
		</details>
	);
}

function Evidence({ path, spanId }: { path: string; spanId: string }) {
	const [open, setOpen] = useState(false);
	const [span, setSpan] = useState<ExecutionSpan | null>(null);
	const [error, setError] = useState('');
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		if (!open) return;
		const controller = new AbortController();
		void projectRequest<ExecutionSpan>(`${path}/spans/${spanId}`, {
			signal: controller.signal,
		})
			.then(value => {
				setSpan(value);
				setError('');
			})
			.catch(e => {
				if (!isCancelled(e)) setError(e.message);
			});
		return () => controller.abort();
	}, [open, path, spanId, attempt]);
	return (
		<details
			className='evaluation-evidence'
			onToggle={e => setOpen(e.currentTarget.open)}>
			<summary>
				Inspect recorded step{' '}
				{span ? `#${span.sequence} · ${span.name}` : ''}
			</summary>
			{open &&
				(error ? (
					<div role='alert'>
						{error}
						<button
							type='button'
							className='button'
							onClick={() =>
								setAttempt(
									value =>
										value +
										1,
								)
							}>
							Retry evidence
						</button>
					</div>
				) : span ? (
					<>
						<strong>{span.name}</strong>
						<div className='trace-payloads'>
							<div>
								<h4>Inputs</h4>
								<pre>
									{JSON.stringify(
										span.inputs,
										null,
										2,
									)}
								</pre>
							</div>
							<div>
								<h4>Outputs</h4>
								<pre>
									{JSON.stringify(
										span.outputs,
										null,
										2,
									)}
								</pre>
								{span.model_visible_output !=
									null && (
									<>
										<h4>
											Agent
											observation
										</h4>
										<pre>
											{
												span.model_visible_output
											}
										</pre>
									</>
								)}
							</div>
						</div>
					</>
				) : (
					<p role='status'>Loading evidence…</p>
				))}
		</details>
	);
}
