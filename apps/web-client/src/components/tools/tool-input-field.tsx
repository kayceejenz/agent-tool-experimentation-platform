'use client';
import { useId, useRef, useState } from 'react';
import type { Schema } from '@/types/tool';

type Props = {
	name: string;
	schema: Schema;
	required: boolean;
	value: unknown;
	disabled: boolean;
	onInvalid: (invalid: boolean) => void;
	onChange: (value: unknown) => void;
	depth?: number;
	schemaRoot?: Schema;
};
export function InputField({
	name,
	schema: suppliedSchema,
	required,
	value,
	disabled,
	onChange,
	onInvalid,
	depth = 0,
	schemaRoot,
}: Props) {
	let schema = suppliedSchema;
	const root = schemaRoot ?? suppliedSchema;
	if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/')) {
		let resolved: unknown = root;
		for (const key of schema.$ref
			.slice(2)
			.split('/')
			.map(part =>
				part
					.replaceAll('~1', '/')
					.replaceAll('~0', '~'),
			)) {
			resolved =
				resolved && typeof resolved === 'object'
					? (resolved as Record<string, unknown>)[
							key
						]
					: undefined;
		}
		if (
			resolved &&
			typeof resolved === 'object' &&
			!Array.isArray(resolved)
		)
			schema = { ...(resolved as Schema), ...schema };
	}
	const id = useId();
	const [draft, setDraft] = useState(
		value === undefined ? '' : JSON.stringify(value, null, 2),
	);
	const [invalid, setInvalid] = useState(false);
	const [arrayKeys, setArrayKeys] = useState(() =>
		Array.isArray(value)
			? value.map((_, index) => String(index))
			: [],
	);
	const nextArrayKey = useRef(arrayKeys.length);
	const [childrenInvalid, setChildrenInvalid] = useState<
		Record<string, boolean>
	>({});
	const title = schema.title ?? name.replaceAll('_', ' ');
	const hintId = `${id}-hint`,
		errorId = `${id}-error`;
	function childInvalid(key: string, next: boolean) {
		const values = { ...childrenInvalid, [key]: next };
		setChildrenInvalid(values);
		onInvalid(Object.values(values).some(Boolean));
	}
	const object =
		value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const array = Array.isArray(value) ? value : [];
	const itemSchema =
		schema.items &&
		typeof schema.items === 'object' &&
		!Array.isArray(schema.items)
			? (schema.items as Schema)
			: undefined;
	if (
		depth < 4 &&
		((schema.type === 'object' && schema.properties) ||
			(schema.type === 'array' && itemSchema))
	) {
		return (
			<fieldset
				className='structured-input'
				disabled={disabled}>
				<legend>
					{title}
					{required
						? ' (required)'
						: ' (optional)'}
				</legend>
				{schema.description && (
					<p className='field-help'>
						{schema.description}
					</p>
				)}
				{!required && (
					<label className='structured-input-toggle'>
						<input
							type='checkbox'
							checked={
								value !==
								undefined
							}
							onChange={e => {
								onChange(
									e.target
										.checked
										? schema.type ===
											'array'
											? []
											: {}
										: undefined,
								);
								setChildrenInvalid(
									{},
								);
								onInvalid(
									false,
								);
							}}
						/>
						Include {title}
					</label>
				)}
				{(required || value !== undefined) &&
					(schema.type === 'object' ? (
						Object.entries(
							schema.properties ?? {},
						).map(([key, child]) => (
							<InputField
								key={key}
								name={key}
								schema={child}
								depth={
									depth +
									1
								}
								schemaRoot={
									root
								}
								required={
									schema.required?.includes(
										key,
									) ??
									false
								}
								value={
									object[
										key
									]
								}
								disabled={
									disabled
								}
								onInvalid={next =>
									childInvalid(
										key,
										next,
									)
								}
								onChange={next => {
									const result =
										{
											...object,
										};
									if (
										next ===
										undefined
									)
										delete result[
											key
										];
									else
										result[
											key
										] =
											next;
									onChange(
										result,
									);
								}}
							/>
						))
					) : (
						<>
							{array.map(
								(
									item,
									index,
								) => (
									<div
										className='array-input-item'
										key={
											arrayKeys[
												index
											] ??
											index
										}>
										<InputField
											name={`Item ${index + 1}`}
											schema={
												itemSchema!
											}
											depth={
												depth +
												1
											}
											schemaRoot={
												root
											}
											required
											value={
												item
											}
											disabled={
												disabled
											}
											onInvalid={next =>
												childInvalid(
													String(
														index,
													),
													next,
												)
											}
											onChange={next =>
												onChange(
													array.map(
														(
															old,
															position,
														) =>
															position ===
															index
																? next
																: old,
													),
												)
											}
										/>
										<button
											type='button'
											className='button'
											aria-label={`Remove ${title} item ${index + 1}`}
											onClick={() => {
												onChange(
													array.filter(
														(
															_,
															position,
														) =>
															position !==
															index,
													),
												);
												setArrayKeys(
													keys =>
														keys.filter(
															(
																_,
																position,
															) =>
																position !==
																index,
														),
												);
												const remaining =
													Object.fromEntries(
														Object.entries(
															childrenInvalid,
														)
															.filter(
																([
																	key,
																]) =>
																	Number(
																		key,
																	) !==
																	index,
															)
															.map(
																([
																	key,
																	invalid,
																]) => [
																	String(
																		Number(
																			key,
																		) >
																			index
																			? Number(
																					key,
																				) -
																					1
																			: Number(
																					key,
																				),
																	),
																	invalid,
																],
															),
													);
												setChildrenInvalid(
													remaining,
												);
												onInvalid(
													Object.values(
														remaining,
													).some(
														Boolean,
													),
												);
											}}>
											Remove
											item
										</button>
									</div>
								),
							)}
							<button
								type='button'
								className='button'
								disabled={
									disabled ||
									array.length >=
										Math.min(
											Number(
												schema.maxItems ??
													100,
											),
											100,
										)
								}
								onClick={() => {
									setArrayKeys(
										keys => [
											...keys,
											String(
												nextArrayKey.current++,
											),
										],
									);
									onChange(
										[
											...array,
											itemSchema?.default ??
												(itemSchema?.type ===
												'object'
													? {}
													: itemSchema?.type ===
																'number' ||
														  itemSchema?.type ===
																'integer'
														? Number(
																itemSchema?.minimum ??
																	0,
															)
														: itemSchema?.type ===
															  'boolean'
															? false
															: ''),
										],
									);
								}}>
								Add item to{' '}
								{title}
							</button>
						</>
					))}
			</fieldset>
		);
	}
	const common = {
		id,
		disabled,
		'aria-describedby':
			`${schema.description ? hintId : ''} ${invalid ? errorId : ''}`.trim() ||
			undefined,
		'aria-invalid': invalid || undefined,
		'aria-required': required,
	};
	return (
		<div className='tool-field'>
			<label htmlFor={id}>
				{title}
				{required ? ' (required)' : ' (optional)'}
			</label>
			{schema.description && (
				<small id={hintId}>{schema.description}</small>
			)}
			{schema.enum ? (
				<select
					{...common}
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
					{...common}
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
					<option value='true'>Yes</option>
					<option value='false'>No</option>
				</select>
			) : ['string', 'number', 'integer'].includes(
					schema.type ?? '',
			  ) ? (
				<input
					{...common}
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
					min={
						typeof schema.minimum ===
						'number'
							? schema.minimum
							: undefined
					}
					max={
						typeof schema.maximum ===
						'number'
							? schema.maximum
							: undefined
					}
					minLength={
						typeof schema.minLength ===
						'number'
							? schema.minLength
							: undefined
					}
					maxLength={
						typeof schema.maxLength ===
						'number'
							? schema.maxLength
							: undefined
					}
					value={
						value === undefined
							? ''
							: String(value)
					}
					onChange={e => {
						const next = e.target.value;
						onChange(
							next === ''
								? undefined
								: schema.type ===
									  'string'
									? next
									: Number(
											next,
										),
						);
						const bad =
							e.target.validity
								.badInput ||
							e.target.validity
								.rangeOverflow ||
							e.target.validity
								.rangeUnderflow ||
							e.target.validity
								.stepMismatch;
						setInvalid(bad);
						onInvalid(bad);
					}}
				/>
			) : (
				<textarea
					{...common}
					rows={4}
					value={draft}
					placeholder='Enter a JSON value'
					spellCheck={false}
					onChange={e => {
						setDraft(e.target.value);
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
							setInvalid(false);
							onInvalid(false);
						} catch {
							setInvalid(true);
							onInvalid(true);
						}
					}}
				/>
			)}
			{invalid && (
				<span
					id={errorId}
					className='mcp-error'
					role='status'>
					{['number', 'integer'].includes(
						schema.type ?? '',
					)
						? 'Enter a number within the allowed range.'
						: 'Enter valid JSON before running this tool.'}
				</span>
			)}
		</div>
	);
}
