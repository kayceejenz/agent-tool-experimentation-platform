import { ReadableText } from '@/components/content/readable-text';

export function ReadableOutput({
	value,
	depth = 0,
}: {
	value: unknown;
	depth?: number;
}) {
	if (value == null)
		return <span className='mcp-meta'>No value returned</span>;
	if (typeof value === 'string') return <ReadableText text={value} />;
	if (typeof value !== 'object') return <span>{String(value)}</span>;
	if (depth >= 3)
		return (
			<details>
				<summary>View nested data</summary>
				<pre>{JSON.stringify(value, null, 2)}</pre>
			</details>
		);
	if (Array.isArray(value)) {
		if (!value.length) return <p>No items returned.</p>;
		if (
			value.every(
				item =>
					item &&
					typeof item === 'object' &&
					!Array.isArray(item),
			)
		) {
			const columns = [
				...new Set(
					value.flatMap(item =>
						Object.keys(item),
					),
				),
			].slice(0, 8);
			return (
				<>
					<div
						className='tool-table-wrap'
						tabIndex={0}
						role='region'
						aria-label='Tool result table'>
						<table className='tool-table readable-output-table'>
							<caption>
								Showing{' '}
								{Math.min(
									value.length,
									50,
								)}{' '}
								of{' '}
								{value.length}{' '}
								items. All
								fields are
								available in the
								raw response.
							</caption>
							<thead>
								<tr>
									{columns.map(
										column => (
											<th
												key={
													column
												}
												scope='col'>
												{column.replaceAll(
													'_',
													' ',
												)}
											</th>
										),
									)}
								</tr>
							</thead>
							<tbody>
								{value
									.slice(
										0,
										50,
									)
									.map(
										(
											row,
											index,
										) => (
											<tr
												key={
													index
												}>
												{columns.map(
													column => (
														<td
															key={
																column
															}>
															<ReadableOutput
																value={
																	row[
																		column
																	]
																}
																depth={
																	depth +
																	1
																}
															/>
														</td>
													),
												)}
											</tr>
										),
									)}
							</tbody>
						</table>
					</div>
				</>
			);
		}
		return (
			<>
				<ul className='readable-output-list'>
					{value
						.slice(0, 50)
						.map((item, index) => (
							<li key={index}>
								<ReadableOutput
									value={
										item
									}
									depth={
										depth +
										1
									}
								/>
							</li>
						))}
				</ul>
				{value.length > 50 && (
					<p>
						Showing 50 of {value.length}{' '}
						items. Open the raw response for
						the complete result.
					</p>
				)}
			</>
		);
	}
	return (
		<dl className='readable-output-fields'>
			{Object.entries(value)
				.slice(0, 50)
				.map(([key, item]) => (
					<div key={key}>
						<dt>
							{key.replaceAll(
								'_',
								' ',
							)}
						</dt>
						<dd>
							<ReadableOutput
								value={item}
								depth={
									depth +
									1
								}
							/>
						</dd>
					</div>
				))}
			{Object.keys(value).length > 50 && (
				<div>
					<dt>More fields</dt>
					<dd>
						Open the raw response to see all
						fields.
					</dd>
				</div>
			)}
		</dl>
	);
}
