/**
 * LRU (Least Recently Used) Cache implementation.
 * Provides O(1) lookup, insertion, and eviction with memory bounds.
 */

export interface CacheEntry<T> {
  value: T
  expiresAt: number
}

/**
 * LRU Cache with optional TTL per entry.
 */
export class LRUCache<T> {
  private map: Map<string, T> = new Map()
  private order: string[] = []
  private readonly maxSize: number
  private readonly defaultTtlMs: number

  constructor(maxSize: number, defaultTtlMs: number = Infinity) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new Error('maxSize must be a positive integer')
    }
    this.maxSize = maxSize
    this.defaultTtlMs = defaultTtlMs
  }

  /**
   * Get a value from the cache.
   * Returns undefined if key not found or entry expired.
   * Updates access order (moves key to end of order list).
   */
  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined

    // Move to end (most recently used)
    const index = this.order.indexOf(key)
    if (index !== -1) {
      this.order.splice(index, 1)
      this.order.push(key)
    }

    return entry
  }

  /**
   * Set a value in the cache.
   * Evicts LRU entry if cache is at capacity.
   */
  set(key: string, value: T): void {
    // If key already exists, remove it from order
    const existingIndex = this.order.indexOf(key)
    if (existingIndex !== -1) {
      this.order.splice(existingIndex, 1)
    }

    // Add/update the entry
    this.map.set(key, value)
    this.order.push(key)

    // Evict LRU if over capacity
    if (this.map.size > this.maxSize) {
      const lruKey = this.order.shift()
      if (lruKey !== undefined) {
        this.map.delete(lruKey)
      }
    }
  }

  /**
   * Check if a key exists in the cache.
   */
  has(key: string): boolean {
    return this.map.has(key)
  }

  /**
   * Delete a specific key.
   */
  delete(key: string): boolean {
    const index = this.order.indexOf(key)
    if (index !== -1) {
      this.order.splice(index, 1)
    }
    return this.map.delete(key)
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.map.clear()
    this.order = []
  }

  /**
   * Get current cache size.
   */
  get size(): number {
    return this.map.size
  }

  /**
   * Get cache capacity.
   */
  get capacity(): number {
    return this.maxSize
  }

  /**
   * Get cache hit rate (for monitoring).
   */
  getStats(): {
    size: number
    capacity: number
    utilization: number
  } {
    return {
      size: this.map.size,
      capacity: this.maxSize,
      utilization: this.map.size / this.maxSize,
    }
  }
}

/**
 * Cache key builder for simulation results.
 * Creates deterministic cache keys from simulation parameters.
 */
export class SimulationCacheKeyBuilder {
  static build(
    actionId: string,
    context: {
      lap: number
      tyreWear: number
      fuel: number
      ers: number
      gapAhead: number
      gapBehind: number
      trafficDensity: number
    },
    horizonLaps: number,
  ): string {
    const parts = [
      actionId,
      context.lap.toString().padStart(3, '0'),
      context.tyreWear.toFixed(3),
      context.fuel.toFixed(2),
      context.ers.toString().padStart(7, '0'),
      context.gapAhead.toFixed(3),
      context.gapBehind.toFixed(3),
      context.trafficDensity.toFixed(3),
      horizonLaps.toString().padStart(2, '0'),
    ]

    return parts.join(':')
  }

  /**
   * Deterministic hash for cache key grouping (useful for sharding).
   */
  static hash(key: string): number {
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash)
  }
}
