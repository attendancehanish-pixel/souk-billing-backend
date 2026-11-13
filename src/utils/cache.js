// Tiny in-memory TTL cache (single server instance). For multiple instances, swap the store for Redis.
const store = new Map();
const MAX_KEYS = 1000;

export function getCache(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.exp < Date.now()) { store.delete(key); return undefined; }
  return hit.val;
}
export function setCache(key, val, ttlMs) {
  if (store.size >= MAX_KEYS) store.delete(store.keys().next().value); // drop oldest
  store.set(key, { val, exp: Date.now() + ttlMs });
}
// Remove keys starting with a string prefix, or matching a RegExp
export function invalidate(...patterns) {
  for (const k of [...store.keys()]) {
    if (patterns.some((p) => (typeof p === 'string' ? k.startsWith(p) : p.test(k)))) store.delete(k);
  }
}

// Middleware: caches successful GET JSON responses. Key = prefix + url + role.
export const cacheGet = (prefix, ttlMs) => (req, res, next) => {
  if (req.method !== 'GET') return next();
  const key = `${prefix}${req.originalUrl}|${req.user?.role || ''}`;
  const hit = getCache(key);
  if (hit !== undefined) { res.set('X-Cache', 'HIT'); return res.json(hit); }
  const send = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400) setCache(key, body, ttlMs);
    res.set('X-Cache', 'MISS');
    return send(body);
  };
  next();
};

// Middleware: on successful POST/PUT/PATCH/DELETE, drop the listed cache entries just before replying
export const bustOnWrite = (...patterns) => (req, res, next) => {
  if (req.method === 'GET') return next();
  const send = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400) invalidate(...patterns);
    return send(body);
  };
  next();
};
