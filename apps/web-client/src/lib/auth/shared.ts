export const ACCESS_COOKIE = 'agent_access_token';
export const REFRESH_COOKIE = 'agent_refresh_token';
export const DEFAULT_CALLBACK = '/projects';

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
		return DEFAULT_CALLBACK;
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
			return DEFAULT_CALLBACK;
		return path === '/' ? DEFAULT_CALLBACK : url.pathname + url.search;
	} catch {
		return DEFAULT_CALLBACK;
	}
}
