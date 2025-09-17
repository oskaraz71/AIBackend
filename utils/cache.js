// server/utils/cache.js
const NodeCache = require("node-cache");

// TTL 30 min, tikrink kas 2 min
const cache = new NodeCache({ stdTTL: 60 * 30, checkperiod: 120 });

/**
 * Paprasta "remember" pagal raktą. Jei yra – grąžina iš cache,
 * jei ne – vykdo fetcher() ir įsideda.
 */
async function remember(key, ttlSeconds, fetcher) {
    const hit = cache.get(key);
    if (hit !== undefined) {
        return { cached: true, value: hit };
    }
    const value = await fetcher();
    cache.set(key, value, ttlSeconds);
    return { cached: false, value };
}

function flush() {
    cache.flushAll();
}

module.exports = { cache, remember, flush };
