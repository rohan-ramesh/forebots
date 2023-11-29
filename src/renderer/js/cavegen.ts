import alea from 'alea'
import * as simplex from 'simplex-noise'
import * as Three from 'three'

import { unwrap } from './util'

// @ts-ignore
import { marchingCubes } from 'isosurface'

export class Cache<T> {
	private map: Map<number, Map<number, Map<number, T>>>
	private keySet: Set<[number, number, number]>

	constructor(private cacheSize: number) {
		this.map = new Map()
		this.keySet = new Set()
	}

	get(x: number, y: number, z: number): T | undefined {
		return this.map.get(x)?.get(y)?.get(z)
	}

	/**
	 * @returns true if the value was inserted, false if it was already present
	 */
	set(x: number, y: number, z: number, value: T): boolean {
		let inserted = false
		if (!this.map.has(x)) {
			this.map.set(x, new Map())
		}
		let xMap = unwrap(this.map.get(x))
		if (!xMap.has(y)) {
			xMap.set(y, new Map())
		}
		let yMap = unwrap(xMap.get(y))
		if (!yMap.has(z)) {
			inserted = true
		}
		yMap.set(z, value)

		// TODO: This should be sublinear time. Need to use a priority queue for
		// this.keySet instead of a JS Set, but ironically would probably be
		// slower for smaller lists due to cache locality BS that is impossible
		// to precisely optimize for in JS.

		let key = [...this.keySet.values()].find(
			([x_, y_, z_]) => x_ == x && y_ == y && z_ == z,
		)
		if (key) {
			this.keySet.delete(key)
		} else if (!inserted) {
			console.warn('How did this happen?')
		}
		this.keySet.add([x, y, z])

		// Evict the oldest member of the cache if it's full
		if (this.keySet.size > this.cacheSize) {
			let oldestKey = this.keySet.keys().next().value
			this.keySet.delete(oldestKey)
			let [x, y, z] = oldestKey
			let xMap = unwrap(this.map.get(x))
			let yMap = unwrap(xMap.get(y))
			yMap.delete(z)
			if (yMap.size == 0) {
				xMap.delete(y)
				if (xMap.size == 0) {
					this.map.delete(x)
				}
			}
		}

		return inserted
	}
}

const BASE_CHUNK_CACHE_SIZE = 16
const CHUNK_CACHE_SIZE = 64

const CHUNK_SIZE = 32
const RESOLUTION = 1

type ChunkWeights = Float32Array
//type Chunk = number[][][]

class Chunk {
	constructor(public geom: Three.BufferGeometry) {}
}

export class Cave {
	private seed: number
	private rand: ReturnType<typeof alea>
	private simplex: simplex.NoiseFunction3D

	private baseChunkCache: Cache<ChunkWeights> = new Cache(BASE_CHUNK_CACHE_SIZE)
	private chunkCache: Cache<Chunk> = new Cache(CHUNK_CACHE_SIZE)

	constructor(seed: number = getSeed()) {
		this.seed = seed
		this.rand = alea(seed)
		this.simplex = simplex.createNoise3D(this.rand)
	}

	getChunk(x: number, y: number, z: number): Chunk {
		let cacheEntry = this.chunkCache.get(x, y, z)
		if (cacheEntry) {
			return cacheEntry
		}

		let baseChunk = this.getBaseChunk(x, y, z)

		let geom = new Three.BufferGeometry()
		console.time('marching cubes')
		let surface = marchingCubes(
			[CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE],
			(x: number, y: number, z: number) => {
				return baseChunk[x * CHUNK_SIZE ** 2 + y * CHUNK_SIZE + z]
			},
		)
		console.timeEnd('marching cubes')
		let vertices = new Float32Array(surface.positions.flat())
		let faces = surface.cells.flat()

		geom.setAttribute('position', new Three.BufferAttribute(vertices, 3))
		geom.setIndex(faces)

		let chunk = new Chunk(geom)
		this.chunkCache.set(x, y, z, chunk)
		return chunk
	}

	getBaseChunk(x: number, y: number, z: number): ChunkWeights {
		let cacheEntry = this.baseChunkCache.get(x, y, z)
		if (cacheEntry) {
			return cacheEntry
		}

		let chunk: ChunkWeights = new Float32Array(CHUNK_SIZE ** 3)
		for (let i = 0; i < CHUNK_SIZE; i++) {
			for (let j = 0; j < CHUNK_SIZE; j++) {
				for (let k = 0; k < CHUNK_SIZE; k++) {
					let x_ = (i / CHUNK_SIZE + x) * RESOLUTION
					let y_ = (j / CHUNK_SIZE + y) * RESOLUTION
					let z_ = (k / CHUNK_SIZE + z) * RESOLUTION
					// prettier-ignore
					chunk[i * CHUNK_SIZE ** 2 + j * CHUNK_SIZE + k] =
						this.simplex(x_, y_, z_)
				}
			}
		}

		this.baseChunkCache.set(x, y, z, chunk)
		return chunk
	}
}

function getSeed() {
	return Math.floor(Math.random() * 0xffffffff)
}
