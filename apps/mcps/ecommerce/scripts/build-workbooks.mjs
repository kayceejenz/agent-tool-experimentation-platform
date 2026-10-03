import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
	await fs.readFile(path.join(here, 'seed-data.json'), 'utf8'),
);
const output = path.resolve(here, '../outputs/ecommerce-demo');
const seed = path.resolve(here, '../src/ecommerce_mcp/seed');
await fs.mkdir(output, { recursive: true });
await fs.mkdir(seed, { recursive: true });
for (const [bookName, sheets] of Object.entries(data.books)) {
	const workbook = Workbook.create();
	for (const [sheetName, rows] of Object.entries(sheets)) {
		const sheet = workbook.worksheets.add(sheetName);
		const headers = rows.length
			? Object.keys(rows[0])
			: data.empty_schemas[sheetName];
		const matrix = rows.map(row =>
			headers.map(key =>
				key.endsWith('_date') && row[key]
					? new Date(`${row[key]}T00:00:00Z`)
					: row[key],
			),
		);
		sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [
			headers,
		];
		if (rows.length)
			sheet.getRangeByIndexes(
				1,
				0,
				rows.length,
				headers.length,
			).values = matrix;
		const last = String.fromCharCode(64 + headers.length);
		const range = sheet.getRange(
			`A1:${last}${Math.max(rows.length + 1, 2)}`,
		);
		range.format.font = {
			name: 'Arial',
			size: 10,
			color: '#172033',
		};
		range.format.rowHeight = 26;
		range.format.verticalAlignment = 'center';
		range.format.columnWidth = 20;
		sheet.showGridLines = false;
		sheet.freezePanes.freezeRows(1);
		sheet.freezePanes.freezeColumns(1);
		const table = sheet.tables.add(
			`A1:${last}${Math.max(rows.length + 1, 2)}`,
			true,
			`${sheetName}Table`,
		);
		table.style = 'TableStyleMedium2';
		for (let index = 0; index < headers.length; index++) {
			const field = headers[index];
			const col = sheet.getRangeByIndexes(
				0,
				index,
				Math.max(rows.length + 1, 2),
				1,
			);
			const body = sheet.getRangeByIndexes(
				1,
				index,
				Math.max(rows.length, 1),
				1,
			);
			col.format.columnWidth =
				field === 'description' || field === 'note'
					? 62
					: field === 'tags' || field === 'method'
						? 42
						: field.includes('name') ||
							  field === 'email' ||
							  field ===
									'customer_email' ||
							  field ===
									'recommended_product_id'
							? 30
							: field ===
								  'payload_hash'
								? 72
								: 20;
			if (field.endsWith('_date')) {
				body.setNumberFormat('dd mmm yyyy');
				body.format.horizontalAlignment = 'center';
			}
			if (
				[
					'price',
					'unit_price',
					'line_total',
					'total',
				].includes(field)
			)
				body.setNumberFormat('"£"#,##0.00" "');
			if (
				field === 'discount' ||
				field === 'similarity_score'
			)
				body.setNumberFormat('0.0%" "');
			if (
				['age', 'quantity', 'stock', 'rank'].includes(
					field,
				)
			)
				body.setNumberFormat('0" "');
			if (field === 'description' || field === 'note') {
				body.format.wrapText = true;
				body.format.rowHeight = 42;
			}
		}
		sheet.getRange(`A1:${last}1`).format = {
			fill: '#1D4ED8',
			font: {
				name: 'Arial',
				size: 10,
				bold: true,
				color: '#FFFFFF',
			},
			rowHeight: 32,
			horizontalAlignment: 'center',
		};
	}
	workbook.recalculate();
	const errors = await workbook.inspect({
		kind: 'match',
		searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#N/A',
		options: { useRegex: true, maxResults: 20 },
		maxChars: 1000,
	});
	console.log(bookName, errors.ndjson);
	for (const sheetName of Object.keys(sheets)) {
		const preview = await workbook.render({
			sheetName,
			range: `A1:${String.fromCharCode(64 + Object.keys(sheets[sheetName][0] ?? Object.fromEntries(data.empty_schemas[sheetName].map(key => [key, null]))).length)}${Math.min(sheets[sheetName].length + 1, 6) || 1}`,
			scale: 1,
			format: 'png',
		});
		await fs.writeFile(
			path.join(output, `${bookName}-${sheetName}.png`),
			new Uint8Array(await preview.arrayBuffer()),
		);
	}
	const file = await SpreadsheetFile.exportXlsx(workbook);
	await file.save(path.join(output, `${bookName}.xlsx`));
	await fs.copyFile(
		path.join(output, `${bookName}.xlsx`),
		path.join(seed, `${bookName}.xlsx`),
	);
	console.log('Saved', bookName);
}
