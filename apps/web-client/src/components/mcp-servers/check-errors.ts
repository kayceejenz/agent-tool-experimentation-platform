export const checkErrors: Record<string, string> = {
	authentication_failed: 'Authentication failed. Check the bearer token.',
	endpoint_blocked: 'The endpoint resolves to a blocked address.',
	redirect_blocked:
		'The endpoint redirects. Configure the final MCP URL.',
	timeout: 'The server did not respond in time. Try again.',
	response_too_large: 'The server response exceeded the size limit.',
	tool_limit_exceeded: 'The tool list exceeded the discovery limit.',
};
