export const ACCESS_COOKIE = 'agent_access_token';
export const REFRESH_COOKIE = 'agent_refresh_token';

export type AuthUser = {
	id: string;
	email: string;
	display_name: string | null;
};

export function safeCallback(value: string | null | undefined): string {
	if (
		!value ||
		!value.startsWith('/') ||
		value.startsWith('//') ||
		/[\\\x00-\x1f]/.test(value)
	)
		return '/';
	try {
		const url = new URL(value, 'https://agent.invalid');
		const path = decodeURIComponent(url.pathname);
		if (
			url.origin !== 'https://agent.invalid' ||
			path.startsWith('/api') ||
			path.startsWith('/auth') ||
			path.startsWith('//') ||
			path.includes('\\')
		)
			return '/';
		return url.pathname + url.search;
	} catch {
		return '/';
	}
}
