import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/db.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { HttpError } from '../../utils/http.js';

const r = Router();
r.use(authenticate, authorize('ADMIN'));
const select = { id: true, name: true, username: true, role: true, isActive: true, createdAt: true };

r.get('/', async (_req, res) => {
  res.json(await prisma.user.findMany({ select, orderBy: { createdAt: 'desc' } }));
});

// Admin creates bill boy users
r.post('/', async (req, res) => {
  const { name, username, password } = req.body;
  if (!name?.trim() || !username?.trim() || !password || password.length < 6)
    throw new HttpError(400, 'Name, username and a password of 6+ characters are required');
  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      username: username.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      role: 'BILL_BOY',
    },
    select,
  });
  res.status(201).json(user);
});

r.patch('/:id', async (req, res) => {
  const data = {};
  if (req.body.name) data.name = req.body.name.trim();
  if (typeof req.body.isActive === 'boolean') {
    if (req.params.id === req.user.id) throw new HttpError(400, 'You cannot deactivate yourself');
    data.isActive = req.body.isActive;
  }
  if (req.body.password) {
    if (req.body.password.length < 6) throw new HttpError(400, 'Password too short');
    data.passwordHash = await bcrypt.hash(req.body.password, 10);
  }
  res.json(await prisma.user.update({ where: { id: req.params.id }, data, select }));
});
export default r;
