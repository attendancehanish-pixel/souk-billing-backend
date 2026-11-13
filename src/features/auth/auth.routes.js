import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { authenticate } from '../../middleware/auth.js';
import { HttpError } from '../../utils/http.js';

const r = Router();
const pub = (u) => ({ id: u.id, name: u.name, username: u.username, role: u.role });

r.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { username } });
  const ok = user && user.isActive && (await bcrypt.compare(String(req.body.password || ''), user.passwordHash));
  if (!ok) throw new HttpError(401, 'Invalid username or password');
  const token = jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: '12h' });
  res.json({ token, user: pub(user) });
});

r.get('/me', authenticate, (req, res) => res.json({ user: pub(req.user) }));
export default r;
