import { Cache } from '../src/renderer/js/cavegen'

describe('Cache', () => {
	it('should store and retrieve values correctly', () => {
		const cache = new Cache<number>(3)

		// Insert values
		cache.set(1, 2, 3, 10)
		cache.set(4, 5, 6, 20)
		cache.set(7, 8, 9, 30)

		// Retrieve values
		expect(cache.get(1, 2, 3)).toBe(10)
		expect(cache.get(4, 5, 6)).toBe(20)
		expect(cache.get(7, 8, 9)).toBe(30)
	})

	it('should return undefined for non-existent values', () => {
		const cache = new Cache<number>(3)

		// Retrieve non-existent values
		expect(cache.get(1, 2, 3)).toBeUndefined()
		expect(cache.get(4, 5, 6)).toBeUndefined()
		expect(cache.get(7, 8, 9)).toBeUndefined()
	})

	it('should evict the oldest member when cache is full', () => {
		const cache = new Cache<number>(3)

		// Insert values
		cache.set(1, 2, 3, 10)
		cache.set(4, 5, 6, 20)
		cache.set(7, 8, 9, 30)
		cache.set(10, 11, 12, 40) // This should evict (1, 2, 3)

		// Retrieve evicted value
		expect(cache.get(1, 2, 3)).toBeUndefined()
	})

	it('should return true when a value is inserted and false when it already exists', () => {
		const cache = new Cache<number>(3)

		// Insert values
		expect(cache.set(1, 2, 3, 10)).toBe(true) // Inserted
		expect(cache.set(1, 2, 3, 20)).toBe(false) // Already exists
	})

	it('should refresh members when they are reinserted', () => {
		const cache = new Cache<number>(3)

		// Insert values
		cache.set(1, 2, 3, 10)
		cache.set(4, 5, 6, 20)
		cache.set(7, 8, 9, 30)
		cache.set(1, 2, 3, 20) // Reinserted
		cache.set(10, 11, 12, 40) // This should evict (4, 5, 6)

		// Retrieve evicted value
		expect(cache.get(4, 5, 6)).toBeUndefined()
		expect(cache.get(1, 2, 3)).toBe(20)
		expect(cache.get(7, 8, 9)).toBe(30)
	})
})
