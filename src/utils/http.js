export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const num = (v) => (v === '' || v == null ? null : Number(v));
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export function errorHandler(err, req, res, _next) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === 'P2002') return res.status(409).json({ message: 'Already exists' });
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
}
