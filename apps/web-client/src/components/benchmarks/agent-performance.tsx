'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ProjectSync } from '@/components/projects/project-provider';
import { projectRequest } from '@/lib/projects/client';
import type { Project } from '@/types/workspace';
import styles from './comparison.module.css';
import chartStyles from './performance-chart.module.css';

type Model = {
	agent_id: string;
	agent_name: string;
	runs: number;
	questions: number;
	completed: number;
	completion_rate: number;
	precision: number | null;
	recall: number | null;
	argument_accuracy: number | null;
	latency_ms: number | null;
};
const percent = (value: number | null) =>
	value === null ? '—' : `${value.toFixed(1)}%`;
const columns = [
	'Agent',
	'Questions',
	'Runs',
	'Tool precision',
	'Tool recall',
	'Argument accuracy',
	'Completion rate',
	'Average latency',
];

export function ModelPerformance({ project }: { project: Project }) {
	const [items, setItems] = useState<Model[] | null>(null);
	const [error, setError] = useState('');
	const [refresh, setRefresh] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		void projectRequest<{ items: Model[] }>(
			`/${project.id}/benchmarks/performance`,
			{ signal: controller.signal },
		)
			.then(data => {
				setItems(data.items);
				setError('');
			})
			.catch(e => {
				if (!controller.signal.aborted)
					setError(e.message);
			});
		return () => controller.abort();
	}, [project.id, refresh]);
	return (
		<>
			<ProjectSync project={project} />
			<header className='workspace-header'>
				<div>
					<Link
						href={`/projects/${project.id}/benchmarks`}>
						← Back to benchmarks
					</Link>
					<h1>Agent performance</h1>
					<p>
						Compare results from your saved
						benchmark runs.
					</p>
				</div>
				<button
					className='button'
					onClick={() => setRefresh(n => n + 1)}>
					Refresh
				</button>
			</header>
			{error && (
				<p role='alert' className='project-error'>
					{error}
				</p>
			)}
			<section
				className='panel simple-benchmark-panel'
				aria-label='Agent performance'>
				{!items ? (
					<p role='status'>
						Loading performance…
					</p>
				) : !items.length ? (
					<div className='empty-state'>
						<h2>No results yet</h2>
						<p>
							Run a benchmark against
							an agent to see its
							performance.
						</p>
					</div>
				) : (
					<>
                        <PerformanceChart items={items} />
                        <h2>Performance breakdown</h2>
						<div
							className={`tool-table-wrap ${styles.wrap}`}
							role='region'
							aria-label='Agent performance comparison'
							tabIndex={0}>
							<table
								className={`tool-table ${styles.table} ${styles.performance}`}>
								<thead>
									<tr>
										{columns.map(
											(
												label,
												i,
											) => (
												<th
													scope='col'
													className={
														i
															? styles.score
															: undefined
													}
													key={
														label
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
									{items.map(
										item => {
											const values =
												[
													item.questions,
													item.runs,
													percent(
														item.precision,
													),
													percent(
														item.recall,
													),
													percent(
														item.argument_accuracy,
													),
													percent(
														item.completion_rate,
													),
													item.latency_ms ===
													null
														? '—'
														: `${(item.latency_ms / 1000).toFixed(2)} s`,
												];
											return (
												<tr
													key={
														item.agent_id
													}>
													<td data-label='Agent'>
														<strong>
															{
																item.agent_name
															}
														</strong>
													</td>
													{values.map(
														(
															value,
															i,
														) => (
															<td
																key={
																	columns[
																		i +
																			1
																	]
																}
																data-label={
																	columns[
																		i +
																			1
																	]
																}
																className={
																	styles.score
																}>
																{
																	value
																}
															</td>
														),
													)}
												</tr>
											);
										},
									)}
								</tbody>
							</table>
						</div>
						<p>
							Includes finished runs,
							retries, failures and
							cancellations for
							current benchmark
							questions. Queue wait is
							excluded from latency.
							Agents may have
							different question
							coverage and agent
							settings.
						</p>
						<details>
							<summary>
								How scores are
								calculated
							</summary>
							<p>
								Precision
								measures
								expected calls
								as a share of
								all calls.
								Recall measures
								how often the
								expected tool
								was called.
								Argument
								accuracy
								averages field
								matches among
								calls to the
								expected tool;
								equivalent
								defaults match.
								Completion rate
								measures runs
								marked
								completed, not
								answer
								correctness.
							</p>
							<p>
								Sorted by
								recall, argument
								accuracy,
								completion rate,
								then lowest
								average latency.
								All values are
								calculated from
								saved
								executions; no
								model judge is
								used.
							</p>
						</details>
					</>
				)}
			</section>
		</>
	);
}

const chartMetrics = {
    recall: { label: 'Tool recall', unit: 'percent' },
    precision: { label: 'Tool precision', unit: 'percent' },
    argument_accuracy: { label: 'Argument accuracy', unit: 'percent' },
    completion_rate: { label: 'Completion rate', unit: 'percent' },
    latency_ms: { label: 'Average latency', unit: 'seconds' },
} as const;
type ChartMetric = keyof typeof chartMetrics;

function PerformanceChart({ items }: { items: Model[] }) {
    const [metric, setMetric] = useState<ChartMetric>('recall');
    const selected = chartMetrics[metric];
    const isLatency = metric === 'latency_ms';
    const maximum = isLatency ? Math.max(1000, ...items.map(item => item.latency_ms ?? 0)) : 100;
    const display = (value: number | null) => value === null ? 'No data' : isLatency ? `${(value / 1000).toFixed(2)} s` : percent(value);
    return <section className={chartStyles.chart} aria-label='Agent performance chart'>
        <div className={chartStyles.toolbar}>
            <h2>Agent comparison</h2>
            <label>Metric
                <select aria-label='Metric' value={metric} onChange={event => setMetric(event.target.value as ChartMetric)}>
                    {Object.entries(chartMetrics).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}
                </select>
            </label>
        </div>
        <p className={chartStyles.hint}>{isLatency ? 'Lower is faster. Queue wait is excluded.' : 'Higher is better. Scores range from 0% to 100%.'}</p>
        <div className={chartStyles.axis} aria-hidden='true'><span>0{isLatency ? ' s' : '%'}</span><span>{isLatency ? `${(maximum / 2000).toFixed(1)} s` : '50%'}</span><span>{isLatency ? `${(maximum / 1000).toFixed(1)} s` : '100%'}</span></div>
        <div className={chartStyles.rows}>
            {items.map(item => {
                const value = item[metric];
                return <div key={item.agent_id} className={chartStyles.row} tabIndex={0} role='img' aria-label={`${item.agent_name}: ${selected.label} ${display(value)}`} title={`${item.agent_name}: ${selected.label} ${display(value)}`}>
                    <span className={chartStyles.name}>{item.agent_name}</span>
                    <div className={chartStyles.track} aria-hidden='true'>
                        {value !== null && <span className={chartStyles.bar} style={{ width: `${Math.max(0, Math.min(100, value / maximum * 100))}%` }} />}
                    </div>
                    <span className={chartStyles.value}>{display(value)}</span>
                </div>;
            })}
        </div>
    </section>;
}
