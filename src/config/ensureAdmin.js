import bcrypt from 'bcryptjs';
import { prisma } from './db.js';
import { env } from './env.js';

// Creates the first admin from env vars if no admin exists yet.
export async function ensureAdmin() {
  const exists = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (exists) return;
  await prisma.user.create({
    data: {
      name: 'Administrator',
      username: env.adminUsername.toLowerCase(),
      passwordHash: await bcrypt.hash(env.adminPassword, 10),
      role: 'ADMIN',
    },
  });
  console.log(`Created admin user "${env.adminUsername}"`);
}
