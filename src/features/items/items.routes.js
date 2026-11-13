import { Router } from 'express';
import { prisma } from '../../config/db.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { HttpError, num } from '../../utils/http.js';
import { bustOnWrite, cacheGet } from '../../utils/cache.js';

const r = Router();
r.use(authenticate);

// Last 3 distinct items this user billed (per-user, so not cached on the server)
r.get('/recent', async (req, res) => {
  const rows = await prisma.billItem.findMany({
    where: { bill: { createdById: req.user.id, isDeleted: false }, item: { isActive: true } },
    orderBy: { bill: { createdAt: 'desc' } },
    take: 40,
    include: { item: true },
  });
  const seen = new Map();
  for (const x of rows) if (!seen.has(x.itemId)) seen.set(x.itemId, x.item);
  res.json([...seen.values()].slice(0, 3));
});

r.use(bustOnWrite('items:'), cacheGet('items:', 60000));

function parse(b, partial = false) {
  const d = {};
  if (!partial || b.category !== undefined) d.category = String(b.category || '').trim();
  if (!partial || b.name !== undefined) d.name = String(b.name || '').trim();
  if (!partial || b.price !== undefined) d.price = num(b.price);
  if ('margin' in b) d.margin = num(b.margin);
  if ('cost' in b) d.cost = num(b.cost);
  if (!partial && (!d.category || !d.name || d.price == null || isNaN(d.price)))
    throw new HttpError(400, 'Category, name and price are required');
  return d;
}

r.get('/', async (req, res) => {
  const all = req.user.role === 'ADMIN' && req.query.all === '1';
  res.json(await prisma.item.findMany({
    where: all ? {} : { isActive: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  }));
});
r.post('/', authorize('ADMIN'), async (req, res) => {
  res.status(201).json(await prisma.item.create({ data: parse(req.body) }));
});
r.patch('/:id', authorize('ADMIN'), async (req, res) => {
  const data = parse(req.body, true);
  if (typeof req.body.isActive === 'boolean') data.isActive = req.body.isActive;
  res.json(await prisma.item.update({ where: { id: req.params.id }, data }));
});
// Soft delete: old bills keep referencing the item
r.delete('/:id', authorize('ADMIN'), async (req, res) => {
  await prisma.item.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ ok: true });
});
export default r;
