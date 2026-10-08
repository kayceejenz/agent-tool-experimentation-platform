export type McpServer = {
	id: string;
	project_id: string;
	name: string;
	endpoint: string;
	transport: 'streamable_http';
	auth_type: 'none' | 'bearer';
	credential_configured: boolean;
	enabled: boolean;
	connection_status: 'untested' | 'connected' | 'error';
	last_checked_at: string | null;
	last_error_code: string | null;
	config_version: number;
	created_at: string;
	updated_at: string;
};

export type McpServerPage = { items: McpServer[]; next_cursor: string | null };
