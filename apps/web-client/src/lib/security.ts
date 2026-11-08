export function contentSecurityPolicy(
	nonce: string,
	development: boolean,
	https: boolean,
	apiUrl?: string,
) {
	let uploadOrigin = '';
	if (apiUrl) {
		const url = new URL(apiUrl);
		if (url.protocol === 'https:' || ((development || !https) && url.protocol === 'http:'))
			uploadOrigin = ` ${url.origin}`;
	}
	return [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self'",
		`connect-src 'self'${uploadOrigin}${development ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
		"object-src 'none'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		...(https ? ['upgrade-insecure-requests'] : []),
	].join('; ');
}
