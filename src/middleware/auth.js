import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';

export async function authenticate(req, _res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) throw new HttpError(401, 'Not authenticated');
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw new HttpError(401, 'Account disabled');
  req.user = user;
  next();
}

// RBAC: authorize('ADMIN') or authorize('ADMIN','BILL_BOY')
export const authorize = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) throw new HttpError(403, 'Forbidden');
  next();
};
