import { prisma } from '../../config/db.js';
import { HttpError, round2 } from '../../utils/http.js';

const include = { items: true, student: true, createdBy: { select: { id: true, name: true } } };

async function prepare(b) {
  const { customerType, customerName, studentId, items, status, paymentMethod } = b;
  if (!['NORMAL', 'STUDENT'].includes(customerType)) throw new HttpError(400, 'Invalid customer type');
  if (!['PAID', 'DUE'].includes(status)) throw new HttpError(400, 'Status must be PAID or DUE');
  if (status === 'PAID' && !['CASH', 'GPAY'].includes(paymentMethod))
    throw new HttpError(400, 'Payment method (CASH or GPAY) is required for paid bills');
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Add at least one item');

  let student = null;
  if (customerType === 'STUDENT') {
    student = await prisma.student.findUnique({ where: { id: String(studentId || '') } });
    if (!student) throw new HttpError(400, 'Select a valid student');
  } else if (!customerName?.trim()) throw new HttpError(400, 'Customer name is required');

  const dbItems = await prisma.item.findMany({ where: { id: { in: items.map((i) => i.itemId) } } });
  const map = new Map(dbItems.map((i) => [i.id, i]));
  const lines = items.map((i) => {
    const it = map.get(i.itemId);
    if (!it) throw new HttpError(400, 'Unknown item in bill');
    const quantity = Number(i.quantity);
    const unitPrice = i.unitPrice != null && i.unitPrice !== '' ? Number(i.unitPrice) : Number(it.price);
    if (!(quantity > 0) || !(unitPrice >= 0)) throw new HttpError(400, 'Invalid quantity or price');
    const costAtSale = it.cost != null ? Number(it.cost) : it.margin != null ? Number(it.price) - Number(it.margin) : null;
    return { itemId: it.id, itemName: it.name, category: it.category, quantity, unitPrice, costAtSale };
  });
  const subtotal = round2(lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0));
  const discount = round2(Number(b.discount) || 0);
  if (discount < 0 || discount > subtotal) throw new HttpError(400, 'Discount must be between 0 and the bill amount');
  const total = round2(subtotal - discount); // final amount after discount
  const data = {
    customerType,
    customerName: student ? student.name : customerName.trim(),
    studentId: student ? student.id : null,
    status,
    paymentMethod: status === 'PAID' ? paymentMethod : null,
    discount,
    total,
  };
  return { data, lines };
}

export async function create(user, body) {
  const { data, lines } = await prepare(body);
  return prisma.bill.create({ data: { ...data, createdById: user.id, items: { create: lines } }, include });
}

export async function list(q, user) {
  const page = Math.max(1, +q.page || 1);
  const limit = Math.min(100, +q.limit || 20);
  const where = {};
  if (!(user.role === 'ADMIN' && q.includeDeleted === 'true')) where.isDeleted = false;
  if (['PAID', 'DUE'].includes(q.status)) where.status = q.status;
  if (q.search) {
    const s = String(q.search).trim();
    where.OR = [
      { customerName: { contains: s, mode: 'insensitive' } },
      { student: { admissionNo: { contains: s, mode: 'insensitive' } } },
    ];
    const m = s.match(/^(?:inv-?)?(\d{1,9})$/i);
    if (m) where.OR.push({ invoiceNo: parseInt(m[1], 10) });
  }
  const [bills, total] = await Promise.all([
    prisma.bill.findMany({ where, orderBy: { invoiceNo: 'desc' }, skip: (page - 1) * limit, take: limit, include: { student: true } }),
    prisma.bill.count({ where }),
  ]);
  return { bills, total, page, pages: Math.ceil(total / limit) };
}

export async function get(id, user) {
  const bill = await prisma.bill.findUnique({ where: { id }, include });
  if (!bill || (bill.isDeleted && user.role !== 'ADMIN')) throw new HttpError(404, 'Bill not found');
  return bill;
}

// Edit: previous version is stored in BillHistory before changes are applied
export async function update(user, id, body) {
  const { data, lines } = await prepare(body);
  return prisma.$transaction(async (tx) => {
    const old = await tx.bill.findFirst({ where: { id, isDeleted: false }, include: { items: true } });
    if (!old) throw new HttpError(404, 'Bill not found');
    await tx.billHistory.create({
      data: { billId: id, action: 'EDIT', editedById: user.id, snapshot: JSON.parse(JSON.stringify(old)) },
    });
    await tx.billItem.deleteMany({ where: { billId: id } });
    return tx.bill.update({ where: { id }, data: { ...data, items: { create: lines } }, include });
  });
}

// Soft delete: row stays in the DB, hidden from lists/reports
export async function remove(user, id) {
  return prisma.$transaction(async (tx) => {
    const old = await tx.bill.findFirst({ where: { id, isDeleted: false }, include: { items: true } });
    if (!old) throw new HttpError(404, 'Bill not found');
    await tx.billHistory.create({
      data: { billId: id, action: 'DELETE', editedById: user.id, snapshot: JSON.parse(JSON.stringify(old)) },
    });
    await tx.bill.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date(), deletedById: user.id } });
    return { ok: true };
  });
}

export const history = (id) => prisma.billHistory.findMany({ where: { billId: id }, orderBy: { createdAt: 'desc' } });
