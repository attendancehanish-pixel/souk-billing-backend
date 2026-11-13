import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { prisma } from '../../config/db.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { HttpError, round2 } from '../../utils/http.js';
import { bustOnWrite, cacheGet } from '../../utils/cache.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
r.use(authenticate, bustOnWrite('students:', 'customers:', 'bills:'), cacheGet('students:', 30000));

r.get('/', async (req, res) => {
  const { q, className } = req.query;
  const where = {};
  if (className) where.className = { equals: String(className), mode: 'insensitive' };
  if (q) where.OR = [
    { name: { contains: String(q), mode: 'insensitive' } },
    { admissionNo: { contains: String(q), mode: 'insensitive' } },
  ];
  res.json(await prisma.student.findMany({ where, orderBy: [{ className: 'asc' }, { name: 'asc' }], take: 100 }));
});

r.get('/classes', async (_req, res) => {
  const rows = await prisma.student.findMany({ distinct: ['className'], select: { className: true }, orderBy: { className: 'asc' } });
  res.json(rows.map((x) => x.className));
});

// Student bill page data: due amount + paid amount
r.get('/:id/summary', async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!student) throw new HttpError(404, 'Student not found');
  const bills = await prisma.bill.findMany({
    where: { studentId: student.id, isDeleted: false },
    orderBy: { createdAt: 'desc' },
    select: { id: true, invoiceNo: true, total: true, status: true, createdAt: true },
  });
  const sum = (s) => round2(bills.filter((b) => b.status === s).reduce((a, b) => a + Number(b.total), 0));
  res.json({ student, paid: sum('PAID'), due: sum('DUE'), totalBilled: round2(sum('PAID') + sum('DUE')), bills: bills.slice(0, 10) });
});

r.post('/', authorize('ADMIN'), async (req, res) => {
  const { admissionNo, name, className } = req.body;
  if (!admissionNo || !name || !className) throw new HttpError(400, 'Admission no, name and class are required');
  res.status(201).json(await prisma.student.create({
    data: { admissionNo: String(admissionNo).trim(), name: String(name).trim(), className: String(className).trim() },
  }));
});

// Bulk import from .xlsx / .csv with columns: Admission No, Name, Class
r.post('/import', authorize('ADMIN'), upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Upload a file in the "file" field');
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const pick = (row, keys) => {
    for (const k of Object.keys(row)) if (keys.includes(k.toLowerCase().replace(/[^a-z]/g, ''))) return String(row[k]).trim();
    return '';
  };
  const valid = [], errors = [];
  rows.forEach((row, i) => {
    const s = {
      admissionNo: pick(row, ['admno', 'admissionno', 'admissionnumber', 'admission']),
      name: pick(row, ['name', 'studentname']),
      className: pick(row, ['class', 'classname', 'std']),
    };
    if (s.admissionNo && s.name && s.className) valid.push(s);
    else errors.push(`Row ${i + 2}: missing admission no, name or class`);
  });
  await prisma.$transaction(
    valid.map((s) => prisma.student.upsert({
      where: { admissionNo: s.admissionNo },
      update: { name: s.name, className: s.className },
      create: s,
    })),
  );
  res.json({ imported: valid.length, skipped: errors.length, errors: errors.slice(0, 20) });
});
export default r;
