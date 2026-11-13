import { Router } from 'express';
import { prisma } from '../../config/db.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { HttpError, round2 } from '../../utils/http.js';

const r = Router();
r.use(authenticate, authorize('ADMIN'));

const OFFSET = process.env.TZ_OFFSET || '+05:30'; // report days are interpreted in IST by default
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const day = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, 'Dates must be YYYY-MM-DD');
  return d;
};
function range(q) {
  const from = day(q.from || today()), to = day(q.to || from);
  return { gte: new Date(`${from}T00:00:00.000${OFFSET}`), lte: new Date(`${to}T23:59:59.999${OFFSET}`) };
}
const loadBills = (createdAt) =>
  prisma.bill.findMany({
    where: { isDeleted: false, createdAt },
    include: { items: true, student: true },
    orderBy: { invoiceNo: 'asc' },
  });
// Profit counts only lines where a cost (or margin) is known
const lineProfit = (l) => (l.costAtSale != null ? Number(l.quantity) * (Number(l.unitPrice) - Number(l.costAtSale)) : 0);
const lineSales = (l) => Number(l.quantity) * Number(l.unitPrice);

r.get('/summary', async (req, res) => {
  const bills = await loadBills(range(req.query));
  let sales = 0, profit = 0, paid = 0, due = 0;
  for (const b of bills) {
    sales += Number(b.total);
    profit += b.items.reduce((a, l) => a + lineProfit(l), 0) - Number(b.discount);
    if (b.status === 'PAID') paid += Number(b.total); else due += Number(b.total);
  }
  res.json({ billCount: bills.length, sales: round2(sales), profit: round2(profit), paid: round2(paid), due: round2(due) });
});

r.get('/items', async (req, res) => {
  const bills = await loadBills(range(req.query));
  const map = new Map();
  for (const b of bills) for (const l of b.items) {
    const row = map.get(l.itemId) || { itemName: l.itemName, category: l.category, quantity: 0, sales: 0, profit: 0 };
    row.quantity += Number(l.quantity); row.sales += lineSales(l); row.profit += lineProfit(l);
    map.set(l.itemId, row);
  }
  res.json([...map.values()].map((x) => ({ ...x, sales: round2(x.sales), profit: round2(x.profit) })).sort((a, b) => b.sales - a.sales));
});

r.get('/daily', async (req, res) => {
  const date = day(req.query.date || today());
  const bills = await loadBills(range({ from: date, to: date }));
  const rows = bills.map((b) => ({
    id: b.id, invoiceNo: b.invoiceNo, time: b.createdAt, customer: b.customerName,
    className: b.student?.className || null, status: b.status, paymentMethod: b.paymentMethod,
    total: Number(b.total), profit: round2(b.items.reduce((a, l) => a + lineProfit(l), 0) - Number(b.discount)),
    items: b.items.map((l) => `${l.itemName} x${Number(l.quantity)} @ ${Number(l.unitPrice)}`).join(', '),
  }));
  res.json({ date, bills: rows, totalSales: round2(rows.reduce((a, b) => a + b.total, 0)), totalProfit: round2(rows.reduce((a, b) => a + b.profit, 0)) });
});
export default r;
