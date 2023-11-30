import { contextBridge, ipcRenderer } from 'electron'
import { IDatabase } from 'src/main/database'
import { Promisify } from 'src/util'

function generateDatabaseFunctions(): Promisify<IDatabase> {
	const functions = {} as Promisify<IDatabase>
	const FUNCTION_NAMES = [
		'getDatabaseSize',
		'getMetadata',
		'setMetadata',
		'getChunkWeights',
		'setChunkWeights',
		'getChunkVertices',
		'setChunkVertices',
		'getChunkFaces',
		'setChunkFaces',
	] as const
	for (const name of FUNCTION_NAMES) {
		functions[name] = async (...args: any[]) => {
			console.log(`Requesting database-${name}...`, ...args)
			return await ipcRenderer.invoke(`database-${name}`, ...args)
		}
	}
	return functions
}

const impl: ElectronAPI = {
	openFile: async () => await ipcRenderer.invoke('open-file-dialog'),

	openDatabase: async (path: string) =>
		await ipcRenderer.invoke('open-database', path),
	currentDatabase: async () => await ipcRenderer.invoke('current-database'),
	closeDatabase: async () => await ipcRenderer.invoke('close-database'),
	saveDatabase: async () => await ipcRenderer.invoke('save-database'),
	saveDatabaseAs: async () => await ipcRenderer.invoke('save-database-as'),

	...generateDatabaseFunctions(),

	getPlatform: async () => await ipcRenderer.invoke('get-platform'),
}

contextBridge.exposeInMainWorld('electronAPI', impl)
