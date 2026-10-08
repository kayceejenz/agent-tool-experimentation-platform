'use client';
import { useState } from 'react';
import type { Schema } from '@/types/tool';

export function InputField({
	name,
	schema,
	required,
	value,
	disabled,
	onChange,
	onInvalid,
}: {
	name: string;
	schema: Schema;
	required: boolean;
	value: unknown;
	disabled: boolean;
	onInvalid: (invalid: boolean) => void;
	onChange: (value: unknown) => void;
}) {
	const [draft, setDraft] = useState(
		value === undefined ? '' : JSON.stringify(value, null, 2),
	);
	const [invalid, setInvalid] = useState(false);
	const simple = ['string', 'number', 'integer', 'boolean'].includes(
		schema.type ?? '',
	);
	return (
		<label className='tool-field'>
			<span>
				{schema.title ?? name}
				{required ? ' *' : ' (optional)'}
			</span>
			{schema.description && (
				<small>{schema.description}</small>
			)}
			{schema.enum ? (
				<select
					disabled={disabled}
					value={
						value === undefined
							? ''
							: JSON.stringify(value)
					}
					onChange={e =>
						onChange(
							e.target.value
								? JSON.parse(
										e
											.target
											.value,
									)
								: undefined,
						)
					}>
					<option value=''>Not set</option>
					{schema.enum.map(item => (
						<option
							key={JSON.stringify(
								item,
							)}
							value={JSON.stringify(
								item,
							)}>
							{String(item)}
						</option>
					))}
				</select>
			) : schema.type === 'boolean' ? (
				<select
					disabled={disabled}
					value={
						value === undefined
							? ''
							: String(value)
					}
					onChange={e =>
						onChange(
							e.target.value === ''
								? undefined
								: e.target
										.value ===
										'true',
						)
					}>
					<option value=''>Not set</option>
					<option value='true'>True</option>
					<option value='false'>False</option>
				</select>
			) : simple ? (
				<input
					disabled={disabled}
					type={
						schema.type === 'string'
							? 'text'
							: 'number'
					}
					step={
						schema.type === 'integer'
							? 1
							: 'any'
					}
					value={
						value === undefined
							? ''
							: String(value)
					}
					onChange={e =>
						onChange(
							e.target.value === ''
								? undefined
								: schema.type ===
									  'string'
									? e
											.target
											.value
									: Number(
											e
												.target
												.value,
										),
						)
					}
				/>
			) : (
				<>
					<textarea
						disabled={disabled}
						rows={4}
						value={draft}
						placeholder='JSON value'
						onChange={e => {
							setDraft(
								e.target.value,
							);
							try {
								onChange(
									e.target
										.value ===
										''
										? undefined
										: JSON.parse(
												e
													.target
													.value,
											),
								);
								setInvalid(
									false,
								);
								onInvalid(
									false,
								);
							} catch {
								setInvalid(
									true,
								);
								onInvalid(true);
							}
						}}
					/>
					{invalid && (
						<span className='mcp-error'>
							Enter valid JSON before
							running this tool.
						</span>
					)}
				</>
			)}
		</label>
	);
}
