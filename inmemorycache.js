module.exports = class InMemoryCache {
  constructor({ defaultTtl = '1h', cleanupInterval = '1h' } = {}) {

    this.cache = new Map();
    this.defaultTtl = defaultTtl;
    this.cleanupInterval = this.parseTime(cleanupInterval); // Clear interval in milliseconds

    // Automatically clear cache at specified interval
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  // Method for checking the existence of a key
  has(key) {
    const cacheEntry = this.cache.get(key);

    if (!cacheEntry) {
      return false;
    } else {
      return true;
    }
  }

  // Method for getting value by key
  get(key) {
    const cacheEntry = this.cache.get(key);

    if (!cacheEntry) {
      return false;
    }

    return cacheEntry.value;
  }

  // Method for getting TTL by key
  getTtl(key) {
    const cacheEntry = this.cache.get(key);

    if (!cacheEntry) {
      return false;
    }

    return cacheEntry.expiration;
  }

  // Method for adding value
  set(key, value, ttl = this.defaultTtl) {
    const cacheEntry = this.cache.get(key);

    if (cacheEntry) { // If something already exists
      return false;
    }

    const expiration = ttl ? Date.now() + this.parseTime(ttl) : null;

    try {
      this.cache.set(key, {
        value: value,
        expiration: expiration
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  // Method for deleting record
  delete(key) {
    const cacheEntry = this.cache.get(key);

    if (cacheEntry) {
      try {
        this.cache.delete(key);
        return true;
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  // Method for updating record without changing TTL
  update(key, value) {
    const cacheEntry = this.cache.get(key);

    if (!cacheEntry) {
      return false;
    }

    // Update the value but leave the old TTL expiration time
    try {
      this.cache.set(key, {
        value: value,
        expiration: cacheEntry.expiration
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  // Method to get all keys
  keys() {
    return Array.from(this.cache.keys());
  }

  // Method to get all values
  values() {
    return Array.from(this.cache.values());
  }

  // Get all key-value pairs
  getcache() {
    return JSON.stringify(Object.fromEntries(Array.from(this.cache)));
  }

  // Method for cleaning out obsolete records
  cleanup() {
    const now = Date.now();
    
    this.cache.forEach((value, key) => {
      if (value.expiration && now > value.expiration) {
        this.cache.delete(key);
      }
    });
  }

  // Method for parsing a string time (e.g. '1h' or '30min') into milliseconds
  parseTime(timeStr) {
    const match = timeStr.match(/^(\d+)(h|min)$/);
    if (!match) {
      throw new Error('Invalid time format. Use "30min" or "1h".');
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'h':
        return value * 60 * 60 * 1000; // Hours to milliseconds
      case 'min':
        return value * 60 * 1000; // Minutes to milliseconds
      default:
        throw new Error('Invalid time unit. Use "h" for hours or "min" for minutes.');
    }
  }
}
