import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import { themeScript } from '@/lib/theme';
import './globals.css';
import './auth.css';
import './projects.css';
import './mcp-servers.css';
import './tools.css';
import './prompts.css';
import './agents.css';

export const metadata: Metadata = {
	title: 'Agent Tool Experiment Platform',
	description:
		'Connect tools, evaluate agents, and inspect their behavior.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang='en' suppressHydrationWarning>
			<head>
				<script
					dangerouslySetInnerHTML={{
						__html: themeScript,
					}}
				/>
			</head>
			<body>{children}</body>
		</html>
	);
}
