import { headers } from 'next/headers';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import { themeScript } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
	title: 'Agent Tool Experiment Platform',
	description:
		'Connect tools, evaluate agents, and inspect their behavior.',
};

export default async function RootLayout({
	children,
}: {
	children: ReactNode;
}) {
	const nonce = (await headers()).get('x-nonce') ?? undefined;
	return (
		<html lang='en' suppressHydrationWarning>
			<head>
				<script
					nonce={nonce}
					dangerouslySetInnerHTML={{
						__html: themeScript,
					}}
				/>
			</head>
			<body>{children}</body>
		</html>
	);
}
