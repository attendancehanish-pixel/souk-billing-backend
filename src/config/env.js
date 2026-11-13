import 'dotenv/config';
export const env = {
  port: process.env.PORT || 4000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  corsOrigin: (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
};
