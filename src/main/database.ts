import * as SQLite from 'better-sqlite3'

export interface IDatabase {
	getDatabaseSize(): number

	getMetadata(key: string): string | undefined
	setMetadata(key: string, value: string): void
	deleteMetadata(key: string): void

	getChunkWeights(x: number, y: number, z: number): Float32Array | undefined
	setChunkWeights(
		x: number,
		y: number,
		z: number,
		weights: Float32Array,
	): void

	getChunkVertices(x: number, y: number, z: number): Float32Array | undefined
	setChunkVertices(
		x: number,
		y: number,
		z: number,
		vertices: Float32Array,
	): void

	getChunkFaces(x: number, y: number, z: number): Uint16Array | undefined
	setChunkFaces(x: number, y: number, z: number, faces: Uint16Array): void
}

export class Database implements IDatabase {
	private stmts
	private txns

	constructor(public conn: SQLite.Database) {
		this.conn.pragma('foreign_keys = ON')

		this.conn.exec(`
			CREATE TABLE IF NOT EXISTS Metadata (
				key TEXT NOT NULL,
				value TEXT NOT NULL,
				PRIMARY KEY (key)
			);

			CREATE TABLE IF NOT EXISTS ChunkProperties (
				x INTEGER NOT NULL,
				y INTEGER NOT NULL,
				z INTEGER NOT NULL,
				property TEXT NOT NULL,
				value BLOB NOT NULL,
				PRIMARY KEY (x, y, z, property)
			);
		`)

		this.stmts = {
			getDatabaseSize: this.conn.prepare(`
				SELECT page_count * page_size AS size
				FROM pragma_page_count(), pragma_page_size()
			`),

			getMetadata: this.conn.prepare(
				'SELECT value FROM Metadata WHERE key = ?',
			),
			setMetadata: this.conn.prepare(
				'INSERT OR REPLACE INTO Metadata (key, value) VALUES (?, ?)',
			),
			deleteMetadata: this.conn.prepare('DELETE FROM Metadata WHERE key = ?'),
			/* getChunk: this.conn.prepare(
				'SELECT weights FROM Chunks WHERE x = ? AND y = ? AND z = ?',
			),
			setChunk: this.conn.prepare(
				'INSERT INTO Chunks (x, y, z, weights) VALUES (?, ?, ?, ?)',
			), */

			getChunkProperties: this.conn.prepare(`
				SELECT property FROM ChunkProperties
				WHERE x = ? AND y = ? AND z = ?
			`),
			getChunkProperty: this.conn.prepare(`
				SELECT value FROM ChunkProperties
				WHERE x = ? AND y = ? AND z = ? AND property = ?
			`),
			setChunkProperty: this.conn.prepare(`
				INSERT OR REPLACE INTO ChunkProperties
				(x, y, z, property, value) VALUES (?, ?, ?, ?, ?)
			`),
			deleteChunkProperty: this.conn.prepare(`
				DELETE FROM ChunkProperties
				WHERE x = ? AND y = ? AND z = ? AND property = ?
			`),
			deleteChunkProperties: this.conn.prepare(`
				DELETE FROM ChunkProperties
				WHERE x = ? AND y = ? AND z = ?
			`),
		}

		this.txns = {}
	}

	getDatabaseSize() {
		let row = this.stmts.getDatabaseSize.get() as { size: number }
		return row.size
	}

	getMetadata(key: string) {
		let row = this.stmts.getMetadata.get(key) as { value: string } | undefined
		return row?.value
	}

	setMetadata(key: string, value: string) {
		this.stmts.setMetadata.run(key, value)
	}

	deleteMetadata(key: string) {
		this.stmts.deleteMetadata.run(key)
	}

	getChunkWeights(x: number, y: number, z: number) {
		let row = this.stmts.getChunkProperty.get(x, y, z, 'weights') as
			| { weights: Buffer }
			| undefined
		return toFloat32Array(row?.weights)
	}

	setChunkWeights(
		x: number,
		y: number,
		z: number,
		weights: Float32Array,
	): void {
		let buf = Buffer.from(weights.buffer)
		this.stmts.setChunkProperty.run(x, y, z, 'weights', buf)
	}

	getChunkVertices(x: number, y: number, z: number) {
		let row = this.stmts.getChunkProperty.get(x, y, z, 'vertices') as
			| { value: Buffer }
			| undefined
		return toFloat32Array(row?.value)
	}

	setChunkVertices(
		x: number,
		y: number,
		z: number,
		vertices: Float32Array,
	) {
		let buf = Buffer.from(vertices.buffer)
		this.stmts.setChunkProperty.run(x, y, z, 'vertices', buf)
	}

	getChunkFaces(x: number, y: number, z: number) {
		let row = this.stmts.getChunkProperty.get(x, y, z, 'faces') as
			| { value: Buffer }
			| undefined
		return toUint16Array(row?.value)
	}

	setChunkFaces(x: number, y: number, z: number, faces: Uint16Array) {
		let buf = Buffer.from(faces.buffer)
		this.stmts.setChunkProperty.run(x, y, z, 'faces', buf)
	}

	close() {
		this.conn.close()
	}
}

function toFloat32Array(buf?: Buffer): Float32Array | undefined{
	if (!buf) {
		return undefined
	}
	let arrayBuf = buf.buffer.slice(
		buf.byteOffset,
		buf.byteOffset + buf.byteLength,
	)
	return new Float32Array(arrayBuf)
}

function toUint16Array(buf?: Buffer): Uint16Array | undefined {
	if (!buf) {
		return undefined
	}
	let arrayBuf = buf.buffer.slice(
		buf.byteOffset,
		buf.byteOffset + buf.byteLength,
	)
	return new Uint16Array(arrayBuf)
}
