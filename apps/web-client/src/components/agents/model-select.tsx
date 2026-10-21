'use client';
import {
	modelCatalog,
	modelOptionLabel,
	pricingSources,
	providerLabels,
} from '@/lib/agents/model-catalog';

type Props = {
	label: string;
	value: string;
	onChange: (model: string, provider: string) => void;
	disabled?: boolean;
	provider?: string;
	inherit?: string;
};
export function ModelSelect({
	label,
	value,
	onChange,
	disabled,
	provider,
	inherit,
}: Props) {
	const selected = modelCatalog.find(model => model.id === value);
	const models = modelCatalog.filter(
		model => !provider || model.provider === provider,
	);
	return (
		<label className='tool-field'>
			{label}
			<select
				aria-label={label}
				value={value}
				disabled={disabled}
				onChange={e => {
					const model = modelCatalog.find(
						model =>
							model.id ===
							e.target.value,
					);
					onChange(
						e.target.value,
						model?.provider ??
							provider ??
							'openai',
					);
				}}>
				<option value=''>
					{inherit ?? 'Select a model'}
				</option>
				{value &&
					!models.some(
						model => model.id === value,
					) && (
						<option value={value}>
							{value} · Saved model
						</option>
					)}
				{(
					[
						'openai',
						'google',
						'anthropic',
						'ollama',
					] as const
				).map(
					group =>
						models.some(
							model =>
								model.provider ===
								group,
						) && (
							<optgroup
								key={group}
								label={
									providerLabels[
										group
									]
								}>
								{models
									.filter(
										model =>
											model.provider ===
											group,
									)
									.map(
										model => (
											<option
												key={
													model.id
												}
												value={
													model.id
												}>
												{modelOptionLabel(
													model,
												)}
											</option>
										),
									)}
							</optgroup>
						),
				)}
			</select>
			{selected && (
				<small>
					{selected.performance}.{' '}
					{selected.provider === 'ollama'
						? 'Pull this exact model in Ollama before running it. Local inference has no per-token API fee; hardware costs still apply.'
						: selected.input !== null &&
							  selected.output !==
									null
							? `Standard text pricing: $${selected.input.toFixed(2)} input / $${selected.output.toFixed(2)} output per 1M tokens. `
							: 'Check current rates with the provider. '}
					{selected.id === 'gemini-2.5-pro' &&
						' For prompts up to 200k tokens; longer prompts cost more. '}
					{selected.id === 'claude-haiku-5-5' &&
						' For prompts up to 100k tokens; longer prompts cost more. '}
					<a
						href={
							pricingSources[
								selected
									.provider
							]
						}
						target='_blank'
						rel='noreferrer'>
						{selected.provider === 'ollama'
							? 'Model details'
							: 'Provider pricing'}
					</a>
				</small>
			)}
			<small>
				Cost and performance labels are guidance, not
				benchmark scores; actual cost depends on usage,
				model access and provider rates.
			</small>
		</label>
	);
}
