// IPC contract types — will be expanded in M3 (security & settings).
// For now, just the result wrapper used by all main → renderer calls.

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };
