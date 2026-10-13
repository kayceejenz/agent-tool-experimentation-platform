'use client';

import { useEffect, useId, useState } from 'react';
import { projectRequest } from '@/lib/projects/client';

interface Totals {
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;
	estimated_cost_usd: string;
	calls: number;
	missing_usage_calls: number;
	unpriced_calls: number;
}
interface Usage {
	totals: Totals;
	sources: { agent: Totals; evaluation: Totals };
	daily: (Totals & { date: string })[];
	pricing_date: string;
}
const number = (value: number) => new Intl.NumberFormat('en-GB').format(value);
const money = (value: string | number) =>
	new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 4,
		maximumFractionDigits: 4,
	}).format(Number(value));

const dayLabel = (day: string) =>
	new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'short',
		timeZone: 'Europe/London',
	});

export function ProjectUsage({ projectId }: { projectId: string }) {
	const [usage, setUsage] = useState<Usage | null>(null);
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(true);
	const [refresh, setRefresh] = useState(0);
	const [activeDay, setActiveDay] = useState<number | null>(null);
	const tooltipId = useId();
	const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens');
	useEffect(() => {
		const controller = new AbortController();
		void projectRequest<Usage>(`/${projectId}/usage`, {
			signal: controller.signal,
		})
			.then(value => {
				if (!controller.signal.aborted) setUsage(value);
			})
			.catch(reason => {
				if (!controller.signal.aborted)
					setError(reason.message);
			})
			.finally(() => {
				if (!controller.signal.aborted)
					setLoading(false);
			});
		return () => controller.abort();
	}, [projectId, refresh]);
	const values =
		usage?.daily.map(day =>
			metric === 'tokens'
				? day.total_tokens
				: Number(day.estimated_cost_usd),
		) ?? [];
	const max = Math.max(0, ...values);
	const refreshUsage = () => {
		setLoading(true);
		setError('');
		setRefresh(n => n + 1);
	};
	return (
		<section
			className='panel dashboard-section project-usage'
			aria-labelledby='project-usage-title'
			aria-busy={loading}>
			<div className='dashboard-heading'>
				<div>
					<h2 id='project-usage-title'>
						Token usage &amp; costs
					</h2>
					<p>All-time project usage.</p>
				</div>
				<button
					className='button'
					disabled={loading}
					onClick={refreshUsage}>
					{loading ? 'Loading…' : 'Refresh usage'}
				</button>
			</div>
			{error ? (
				<p role='alert'>{error}</p>
			) : !usage ? (
				<p role='status'>Loading recorded usage…</p>
			) : (
				<>
					<dl className='usage-totals'>
						<div>
							<dt>Tokens used</dt>
							<dd>
								{number(
									usage
										.totals
										.total_tokens,
								)}
							</dd>
							<small>
								{number(
									usage
										.totals
										.input_tokens,
								)}{' '}
								input ·{' '}
								{number(
									usage
										.totals
										.output_tokens,
								)}{' '}
								output
							</small>
						</div>
						<div>
							<dt>
								Estimated cost
								(USD)
							</dt>
							<dd>
								{money(
									usage
										.totals
										.estimated_cost_usd,
								)}
							</dd>
						</div>
					</dl>
					<table
						className='usage-breakdown-table'
						aria-label='Usage by activity'>
						<thead>
							<tr>
								<th scope='col'>
									Activity
								</th>
								<th scope='col'>
									Tokens
								</th>
								<th scope='col'>
									Cost
									(USD)
								</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<th scope='row'>
									Agent
									runs
								</th>
								<td>
									{number(
										usage
											.sources
											.agent
											.total_tokens,
									)}
								</td>
								<td>
									{money(
										usage
											.sources
											.agent
											.estimated_cost_usd,
									)}
								</td>
							</tr>
							<tr>
								<th scope='row'>
									Evaluations
								</th>
								<td>
									{number(
										usage
											.sources
											.evaluation
											.total_tokens,
									)}
								</td>
								<td>
									{money(
										usage
											.sources
											.evaluation
											.estimated_cost_usd,
									)}
								</td>
							</tr>
						</tbody>
					</table>
					<details className='usage-trends'>
						<summary>
							View usage trends
						</summary>
						<div className='usage-chart-heading'>
							<h3>Last 14 days</h3>
							<div
								role='group'
								aria-label='Chart metric'>
								<button
									className='button'
									aria-pressed={
										metric ===
										'tokens'
									}
									onClick={() =>
										setMetric(
											'tokens',
										)
									}>
									Tokens
								</button>
								<button
									className='button'
									aria-pressed={
										metric ===
										'cost'
									}
									onClick={() =>
										setMetric(
											'cost',
										)
									}>
									Cost
								</button>
							</div>
						</div>
						{max === 0 ? (
							<p className='usage-empty'>
								No{' '}
								{metric ===
								'tokens'
									? 'recorded token usage'
									: 'estimated costs'}{' '}
								in the last 14
								days.
							</p>
						) : (
							<>
								<p className='usage-chart-scale'>
									Peak
									daily{' '}
									{metric ===
									'tokens'
										? `usage: ${number(max)} tokens`
										: `cost: ${money(max)}`}
								</p>
								<div
									className='usage-chart-interactive'
									onMouseLeave={() =>
										setActiveDay(
											null,
										)
									}>
									<svg
										className='usage-chart'
										viewBox='0 0 760 150'
										preserveAspectRatio='none'
										role='img'
										aria-label={`Daily ${metric === 'tokens' ? 'token usage' : 'estimated cost in USD'} over the last 14 days. Exact values are available in Daily usage details.`}>
										<line
											x1='0'
											y1='24'
											x2='760'
											y2='24'
										/>
										<line
											x1='0'
											y1='145'
											x2='760'
											y2='145'
										/>
										{usage.daily.map(
											(
												day,
												index,
											) => {
												const height =
													(values[
														index
													] /
														max) *
													110;
												return (
													<g
														key={
															day.date
														}>
														<rect
															x={
																index *
																	54 +
																12
															}
															y={
																145 -
																height
															}
															width='30'
															height={
																height
															}
															rx='4'>
															<title>
																{dayLabel(
																	day.date,
																)}

																:{' '}
																{metric ===
																'tokens'
																	? `${number(day.total_tokens)} tokens`
																	: money(
																			day.estimated_cost_usd,
																		)}
															</title>
														</rect>
													</g>
												);
											},
										)}
									</svg>
									<div
										className='usage-chart-targets'
										role='group'
										aria-label='Daily usage values'>
										{usage.daily.map(
											(
												day,
												index,
											) => (
												<button
													key={
														day.date
													}
													type='button'
													className='usage-chart-target'
													aria-label={`${dayLabel(day.date)}: ${number(day.total_tokens)} tokens, ${money(day.estimated_cost_usd)} estimated cost`}
													aria-describedby={
														activeDay ===
														index
															? tooltipId
															: undefined
													}
													onMouseEnter={() =>
														setActiveDay(
															index,
														)
													}
													onFocus={() =>
														setActiveDay(
															index,
														)
													}
													onBlur={() =>
														setActiveDay(
															null,
														)
													}
													onClick={() =>
														setActiveDay(
															index,
														)
													}
													onKeyDown={event => {
														if (
															event.key ===
															'Escape'
														)
															setActiveDay(
																null,
															);
													}}
												/>
											),
										)}
									</div>
									{activeDay !==
										null && (
										<div
											role='tooltip'
											id={
												tooltipId
											}
											className='usage-chart-tooltip'
											style={{
												left: `clamp(90px, ${((activeDay + 0.5) / usage.daily.length) * 100}%, calc(100% - 90px))`,
											}}>
											<strong>
												{dayLabel(
													usage
														.daily[
														activeDay
													]
														.date,
												)}
											</strong>
											<span>
												{number(
													usage
														.daily[
														activeDay
													]
														.total_tokens,
												)}{' '}
												tokens
											</span>
											<span>
												{money(
													usage
														.daily[
														activeDay
													]
														.estimated_cost_usd,
												)}{' '}
												estimated
												cost
											</span>
										</div>
									)}
								</div>
								<div
									className='usage-chart-dates'
									aria-hidden='true'>
									<span>
										{dayLabel(
											usage
												.daily[0]
												.date,
										)}
									</span>
									<span>
										{dayLabel(
											usage
												.daily[6]
												.date,
										)}
									</span>
									<span>
										{dayLabel(
											usage
												.daily[13]
												.date,
										)}
									</span>
								</div>
							</>
						)}
						<details className='usage-details'>
							<summary>
								Daily usage
								details
							</summary>
							<div
								className='usage-table-scroll'
								tabIndex={0}
								role='region'
								aria-label='Daily token usage and estimated costs'>
								<table>
									<caption>
										Daily
										recorded
										usage
										·
										Europe/London
									</caption>
									<thead>
										<tr>
											<th scope='col'>
												Date
											</th>
											<th scope='col'>
												Total
												tokens
											</th>
											<th scope='col'>
												Estimated
												USD
											</th>
										</tr>
									</thead>
									<tbody>
										{usage.daily.map(
											day => (
												<tr
													key={
														day.date
													}>
													<th scope='row'>
														{dayLabel(
															day.date,
														)}
													</th>
													<td>
														{number(
															day.total_tokens,
														)}
													</td>
													<td>
														{money(
															day.estimated_cost_usd,
														)}
													</td>
												</tr>
											),
										)}
									</tbody>
								</table>
							</div>
						</details>
						<p className='usage-footnote'>
							Costs use standard paid
							token rates, verified{' '}
							{usage.pricing_date}.
							Your provider bill may
							differ because of
							discounts or free usage.
						</p>
					</details>
				</>
			)}
		</section>
	);
}
