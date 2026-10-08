'use client';
import type { useAgentEditor } from '@/components/agents/use-agent-editor';

type Props = Pick<ReturnType<typeof useAgentEditor>, 'current'
	| 'form'
	| 'dirty'
	| 'disabled'
	| 'toggle'
	| 'field'
	| 'managing'>;

export function AgentDetailsFields({ current, form, dirty, disabled, toggle, field, managing }: Props) {
	return (
		<>
			<label className='tool-field'>
				Name
				<input
					autoFocus={!managing}
					required
					maxLength={160}
					disabled={disabled}
					value={form.name}
					onChange={e =>
						field(
							'name',
							e
								.target
								.value,
						)
					}
				/>
			</label>
			<label className='tool-field'>
				Description
				<textarea
					maxLength={2000}
					rows={3}
					disabled={disabled}
					value={form.description}
					onChange={e =>
						field(
							'description',
							e
								.target
								.value,
						)
					}
				/>
			</label>
			{current && (
				<section className='agent-section'>
					<div className='mcp-sheet-section-heading'>
						<h3>
							Availability
						</h3>
						<button
							type='button'
							role='switch'
							className='mcp-toggle'
							aria-label='Enable agent'
							aria-checked={current.enabled}
							disabled={
								disabled ||
								dirty ||
								(!current.enabled &&
									!current.configuration_ready)
							}
							onClick={() => void toggle()}>
							<span
								aria-hidden
							/>
							<span>
								{current.enabled
									? 'Enabled'
									: 'Disabled'}
							</span>
						</button>
					</div>
					{dirty && (
						<p className='mcp-note'>
							Save
							your
							changes
							before
							changing
							availability.
						</p>
					)}
					<h4>
						Saved
						configuration
					</h4>
					{current
						.configuration_issues
						.length ? (
						<ul className='agent-issues'>
							{current.configuration_issues.map(
								issue => (
									<li
										key={issue}>
										{issue}
									</li>
								),
							)}
						</ul>
					) : (
						<p className='mcp-note'>
							Configuration
							complete.
							Provider
							compatibility
							and
							credentials
							will
							be
							checked
							when
							model
							integration
							is
							added.
						</p>
					)}
					<p className='mcp-note'>
						Model
						execution
						and
						the
						playground
						are
						not
						available
						yet.
					</p>
				</section>
			)}
		</>
	);
}
