import app from './app.js';
import { env } from './config/env.js';
import { ensureAdmin } from './config/ensureAdmin.js';

await ensureAdmin();
app.listen(env.port, () => console.log(`API running on :${env.port}`));
