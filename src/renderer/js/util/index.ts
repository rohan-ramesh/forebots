export function assert(
	condition: any,
	message?: string,
): asserts condition {
	if (!condition) {
		throw new Error(message ?? 'Assertion failed')
	}
}

export function unwrap<T>(value: T | null | undefined): T {
	assert(value != null, 'Value is null or undefined')
	return value
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max)
}