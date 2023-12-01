import '../../../preload/types.d.ts'

export function assert(condition: any, message?: string): asserts condition {
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

let platform = await window.electronAPI.getPlatform()
export function basename(path: string): string {
	if (platform == 'win32') {
		return path.split(/\\|\//).pop()!
	} else {
		return path.split('/').pop()!
	}
}

export function sizeToString(size: number): string {
	let units = ['Bytes', 'KB', 'MB', 'GB', 'TB']
	let unit = 0
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024
		unit++
	}
	return size.toFixed(2) + ' ' + units[unit]
}

export function* iterateInChunks<T>(
	iterable: Iterable<T>,
	chunkSize: number,
): Generator<T[]> {
	let chunk: T[] = []
	for (let item of iterable) {
		chunk.push(item)
		if (chunk.length == chunkSize) {
			yield chunk
			chunk = []
		}
	}
	if (chunk.length > 0) {
		yield chunk
	}
}

export abstract class EventEmitter<T> {
	private listeners: {
		[evtType in keyof T]?: {
			cb: (param: T[evtType]) => void
			once: boolean
		}[]
	} = {}

	on<K extends keyof T>(event: K, cb: (param: T[K]) => void) {
		this.listeners[event] ??= []
		this.listeners[event]!.push({ cb, once: false })
	}

	once<K extends keyof T>(event: K, cb: (param: T[K]) => void) {
		this.listeners[event] ??= []
		this.listeners[event]!.push({ cb, once: true })
	}

	off<K extends keyof T>(event: K, cb: (param: T[K]) => void) {
		if (this.listeners[event] === undefined) {
			return
		}
		let idx = this.listeners[event]!.findIndex((l) => l.cb === cb)
		if (idx === -1) {
			return
		}
		this.listeners[event]!.splice(idx, 1)
	}

	emit<K extends keyof T>(event: K, param: T[K]) {
		if (this.listeners[event] === undefined) {
			return
		}
		this.listeners[event] = this.listeners[event]!.filter((l) => {
			l.cb(param)
			return !l.once
		})
	}
}
