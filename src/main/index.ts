import {
	app,
	shell,
	BrowserWindow,
	ipcMain,
	dialog,
	globalShortcut,
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

import SQLite from 'better-sqlite3'

// @ts-ignore
import icon from '../../resources/icon.png?asset'

import { Database } from './database'

function createWindow(): void {
	const mainWindow = new BrowserWindow({
		width: 1280,
		height: 720,
		show: false,
		autoHideMenuBar: true,
		...(process.platform === 'linux' ? { icon } : {}),
		webPreferences: {
			preload: join(__dirname, '../preload/index.js'),
			sandbox: false,
		},
	})

	mainWindow.on('ready-to-show', () => {
		mainWindow.show()
	})

	mainWindow.webContents.setWindowOpenHandler((details) => {
		shell.openExternal(details.url)
		return { action: 'deny' }
	})

	if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
		mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
	} else {
		mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
	}
}

app.whenReady().then(() => {
	electronApp.setAppUserModelId('com.electron')

	globalShortcut.register('CommandOrControl+W', () => {
		// Do nothing
	})
	globalShortcut.register('CommandOrControl+Shift+W', () => {
		BrowserWindow.getFocusedWindow()?.close()
	})

	ipcMain.handle('open-file-dialog', async () => {
		const { canceled, filePaths } = await dialog.showOpenDialog({
			properties: ['openFile'],
			filters: [{ name: 'Forebots SQLite file', extensions: ['db'] }],
		})
		if (!canceled) {
			return filePaths[0]
		}
	})

	let databasePath: string | undefined
	let database: Database = new Database(new SQLite(':memory:'))

	ipcMain.handle('open-database', async (_, path: string) => {
		databasePath = path
		database = new Database(new SQLite(path))
	})

	ipcMain.handle('current-database', async () => {
		return databasePath
	})

	ipcMain.handle('close-database', async () => {
		database?.close()
		database = new Database(new SQLite(':memory:'))
		databasePath = undefined
	})

	ipcMain.handle('save-database', async (_, path: string) => {
		database.conn.exec('VACUUM')
	})

	ipcMain.handle('save-database-as', async (_) => {
		let dest = dialog.showSaveDialogSync({
			filters: [{ name: 'Forebots SQLite file', extensions: ['db'] }],
		})
		if (!dest) {
			return { canceled: true }
		}
		await database.conn.backup(dest)
		return { canceled: false, path: dest }
	})

	const FORWARDED_METHODS = [
		'getDatabaseSize',
		'getMetadata',
		'setMetadata',
		'deleteMetadata',
		'getChunkWeights',
		'setChunkWeights',
		'getChunkVertices',
		'setChunkVertices',
		'getChunkFaces',
		'setChunkFaces',
	] as const

	const BORING_METHODS = ['getDatabaseSize']

	let lastMethod = ''
	for (let method of FORWARDED_METHODS) {
		ipcMain.handle(`database-${method}`, async (_, ...args) => {
			if (!BORING_METHODS.includes(method) && method !== lastMethod) {
				lastMethod = method
				console.log(`Performing database-${method}...`, ...args)
			}
			return (database?.[method] as any)(...args)
		})
	}

	ipcMain.handle('get-platform', () => {
		return process.platform
	})

	app.on('browser-window-created', (_, window) => {
		optimizer.watchWindowShortcuts(window)
	})

	createWindow()
	app.on('activate', function () {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit()
	}
})
