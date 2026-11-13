import { Router } from 'express';
import { prisma } from '../../config/db.js';
import { authenticate } from '../../middleware/auth.js';
import { HttpError, round2 } from '../../utils/http.js';
import { cacheGet } from '../../utils/cache.js';

const r = Router();
r.use(authenticate, cacheGet('customers:', 15000)); // admin and bill boy

function totals(bills) {
  const t = { bills: bills.length, amount: 0, paid: 0, due: 0, cash: 0, gpay: 0 };
  for (const b of bills) {
    const v = Number(b.total);
    t.amount += v;
    if (b.status === 'PAID') {
      t.paid += v;
      if (b.paymentMethod === 'CASH') t.cash += v;
      if (b.paymentMethod === 'GPAY') t.gpay += v;
    } else t.due += v;
  }
  for (const k of ['amount', 'paid', 'due', 'cash', 'gpay']) t[k] = round2(t[k]);
  return t;
}

// List: ?type=STUDENT|NORMAL&q=&className=
r.get('/', async (req, res) => {
  const { type = 'STUDENT', q = '', className = '' } = req.query;
  const billSel = { where: { isDeleted: false }, select: { total: true, status: true, paymentMethod: true } };

  if (type === 'STUDENT') {
    const where = {};
    if (className) where.className = { equals: String(className), mode: 'insensitive' };
    if (q) where.OR = [
      { name: { contains: String(q), mode: 'insensitive' } },
      { admissionNo: { contains: String(q), mode: 'insensitive' } },
    ];
    const students = await prisma.student.findMany({
      where, orderBy: [{ className: 'asc' }, { name: 'asc' }], take: 500, include: { bills: billSel },
    });
    return res.json(students.map((s) => ({
      key: s.id, name: s.name, admissionNo: s.admissionNo, className: s.className, ...totals(s.bills),
    })));
  }

  const bills = await prisma.bill.findMany({
    where: { customerType: 'NORMAL', isDeleted: false, ...(q ? { customerName: { contains: String(q), mode: 'insensitive' } } : {}) },
    select: { customerName: true, total: true, status: true, paymentMethod: true },
  });
  const groups = new Map();
  for (const b of bills) {
    const key = b.customerName.trim().toLowerCase();
    const g = groups.get(key) || { key, name: b.customerName.trim(), bills: [] };
    g.bills.push(b);
    groups.set(key, g);
  }
  res.json([...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({ key: g.key, name: g.name, ...totals(g.bills) })));
});

// Detail: /student/:studentId  or  /normal/:lowercasedName
r.get('/:kind/:key', async (req, res) => {
  const { kind, key } = req.params;
  let where, profile;
  if (kind === 'student') {
    profile = await prisma.student.findUnique({ where: { id: key } });
    if (!profile) throw new HttpError(404, 'Student not found');
    where = { studentId: key, isDeleted: false };
  } else if (kind === 'normal') {
    where = { customerType: 'NORMAL', customerName: { equals: key, mode: 'insensitive' }, isDeleted: false };
  } else throw new HttpError(400, 'Invalid kind');

  const bills = await prisma.bill.findMany({
    where, orderBy: { invoiceNo: 'desc' },
    select: {
      id: true, invoiceNo: true, total: true, discount: true, status: true, paymentMethod: true, createdAt: true, customerName: true,
      items: { select: { itemName: true, quantity: true } },
    },
  });
  if (kind === 'normal' && !bills.length) throw new HttpError(404, 'Customer not found');
  res.json({
    kind,
    name: profile ? profile.name : bills[0].customerName,
    student: profile,
    totals: totals(bills),
    bills: bills.map((b) => ({ ...b, items: b.items.map((i) => `${i.itemName} x${Number(i.quantity)}`).join(', ') })),
  });
});
export default r;
