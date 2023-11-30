export type Promisify<T> = {
	[P in keyof T]: T[P] extends (...args: infer A) => infer R
		? (...args: A) => Promise<R>
		: never
}
