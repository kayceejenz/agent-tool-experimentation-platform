/** Only operation identity is persisted: never credentials or tool arguments. */
export function operationKey(
	userId: string,
	projectId: string,
	toolId: string,
) {
	return `agent-tool-operation:${userId}:${projectId}:${toolId}`;
}
export function pendingOperation(key: string): string | null {
	const value = sessionStorage.getItem(key);
	if (
		value &&
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			value,
		)
	) {
		// A corrupted recovery record must not silently become a fresh write.
		throw new Error(
			'Unable to read the saved operation. Check the remote system before starting a new test.',
		);
	}
	return value;
}
export function reserveOperation(key: string): string {
	if (pendingOperation(key))
		throw new Error(
			'Check the saved operation before starting a new test.',
		);
	const id = crypto.randomUUID();
	sessionStorage.setItem(key, id);
	return id;
}
export function clearOperation(key: string) {
	sessionStorage.removeItem(key);
}
