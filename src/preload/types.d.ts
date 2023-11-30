//import { IDatabase } from 'src/main/database'
//import { Promisify } from 'src/utils'

// TODO: Make the import work properly. We still kinda get type checking, but
// the errors show up in preload/index.ts instead of here. Diagnostics are still
// pretty good so not a huge deal.

declare type ElectronAPI = /* Promisify<IDatabase> & */ {
	openFile: () => Promise<string | undefined>

	getDatabaseSize(): Promise<number>

	getMetadata(key: string): Promise<string | undefined>
	setMetadata(key: string, value: string): Promise<void>
	deleteMetadata(key: string): Promise<void>

	getChunkWeights(
		x: number,
		y: number,
		z: number,
	): Promise<Float32Array | undefined>
	setChunkWeights(
		x: number,
		y: number,
		z: number,
		weights: Float32Array,
	): Promise<void>

	getChunkVertices(
		x: number,
		y: number,
		z: number,
	): Promise<Float32Array | undefined>
	setChunkVertices(
		x: number,
		y: number,
		z: number,
		vertices: Float32Array,
	): Promise<void>

	getChunkFaces(
		x: number,
		y: number,
		z: number,
	): Promise<Uint16Array | undefined>
	setChunkFaces(
		x: number,
		y: number,
		z: number,
		faces: Uint16Array,
	): Promise<void>

	openDatabase: (path: string) => Promise<void>
	currentDatabase: () => Promise<string | undefined>
	closeDatabase: () => Promise<void>
	saveDatabase: () => Promise<void>
	saveDatabaseAs: () => Promise<
		{ canceled: true } | { canceled: false; path: string | undefined }
	>

	getPlatform: () => Promise<typeof process.platform>
}

declare interface Window {
	electronAPI: ElectronAPI
}
