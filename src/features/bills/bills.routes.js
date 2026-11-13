import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { bustOnWrite, cacheGet } from '../../utils/cache.js';
import * as svc from './bills.service.js';

const r = Router();
r.use(authenticate, authorize('ADMIN', 'BILL_BOY'));
// any bill change refreshes bill lists, customer totals and student paid/due summaries
r.use(bustOnWrite('bills:', 'customers:', /^students:.*\/summary/), cacheGet('bills:', 15000));
r.get('/', async (req, res) => res.json(await svc.list(req.query, req.user)));
r.post('/', async (req, res) => res.status(201).json(await svc.create(req.user, req.body)));
r.get('/:id', async (req, res) => res.json(await svc.get(req.params.id, req.user)));
r.put('/:id', async (req, res) => res.json(await svc.update(req.user, req.params.id, req.body)));
r.delete('/:id', async (req, res) => res.json(await svc.remove(req.user, req.params.id)));
r.get('/:id/history', authorize('ADMIN'), async (req, res) => res.json(await svc.history(req.params.id)));
export default r;
