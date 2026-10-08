'use client';
import type { useAgentEditor } from '@/components/agents/use-agent-editor';

export function AgentLimitsFields({ form, disabled, field }: Pick<ReturnType<typeof useAgentEditor>, 'form' | 'disabled' | 'field'>) {
	return (
		<>
			<p className='mcp-note'>
				The
				agent
				uses
				tools in
				sequence
				until
				the task
				is
				complete.
				Each
				tool
				call
				usually
				needs
				another
				model
				turn;
				reserve
				one for
				the
				final
				answer.
				These
				budgets
				are
				enforced
				during
				execution.
				Zero
				tool
				calls
				permits
				an agent
				that
				only
				answers
				using
				its
				instructions.
			</p>
			{(
				[
					[
						'max_turns',
						'Maximum model turns',
						1,
						50,
					],
					[
						'max_tool_calls',
						'Maximum tool calls',
						0,
						100,
					],
					[
						'timeout_seconds',
						'Total duration (seconds)',
						1,
						300,
					],
					[
						'max_output_tokens',
						'Maximum output tokens per response',
						1,
						32000,
					],
				] as const
			).map(
				([
					key,
					label,
					min,
					max,
				]) => (
					<label
						className='tool-field'
						key={key}>
						{label}
						<input
							type='number'
							required
							min={min}
							max={max}
							step={1}
							disabled={disabled}
							value={
								form
									.limits[
								key
								]
							}
							onChange={e =>
								field(
									'limits',
									{
										...form.limits,
										[key]: Number(
											e
												.target
												.value,
										),
									},
								)
							}
						/>
					</label>
				),
			)}
		</>
	);
}
