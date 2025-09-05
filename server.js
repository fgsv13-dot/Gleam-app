// --- Gleam backend: upload -> create job -> status -> download ---
// ملاحظات:
// 1) هذا يهيّئ بنية “وظائف تحويل” تعمل الآن بشكل مبدئي (نسخ الملف وإعادة تسميته)
//    لتجربتك بدون صفحة بيضاء. لاحقًا استبدل دالة runConversion()
//    بمحرّك تحويل APK/EXE الحقيقي أو استدعاء خدمة خارجية.
// 2) مهيأ للعمل على Render المجاني (التخزين في /tmp).

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { nanoid } = require('nanoid');
const morgan = require('morgan');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const app = express();

// ---------- إعدادات عامة ----------
const ALLOWED_ORIGINS = new Set([
  process.env.ALLOWED_ORIGIN || 'https://gleam-app-meker.netlify.app'
]);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 50); // حد الرفع
const TMP_DIR = process.env.UPLOAD_DIR || path.join(os.tmpdir(), 'gleam');
const OUT_DIR = path.join(TMP_DIR, 'out');
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------- وسطيات ----------
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || origin === 'null' || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      return cb(new Error('CORS_BLOCKED'), false);
    }
  })
);

// Multer: رفع إلى /tmp مع فلترة ZIP
const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok =
      /(\.zip)$/i.test(file.originalname) ||
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed';
    if (!ok) return cb(new Error('UNSUPPORTED_TYPE'));
    cb(null, true);
  }
});

// ---------- ذاكرة بسيطة لإدارة الملفات والوظائف ----------
/** fileId -> { path, name, size, uploadedAt } */
const files = new Map();
/** jobId -> { status: 'queued'|'processing'|'done'|'error',
               target: 'apk'|'exe',
               fileId, outputPath?, outputName?, error?, createdAt, doneAt? } */
const jobs = new Map();

// ---------- مسارات عامة ----------
app.get('/api/health', (req, res) =>
  res.json({ ok: true, time: Date.now(), tmp: TMP_DIR })
);

// صفحة رئيسية بسيطة (لمن يزور الجذر)
app.get('/', (req, res) => res.send('Backend OK'));

// ---------- رفع الملف ----------
app.post('/api/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });

    const fileId = nanoid(10);
    files.set(fileId, {
      path: req.file.path, // مسار مؤقت داخل /tmp
      name: req.file.originalname,
      size: req.file.size,
      uploadedAt: Date.now()
    });

    return res.json({
      ok: true,
      fileId,
      filename: req.file.originalname,
      size: req.file.size
    });
  } catch (e) {
    next(e);
  }
});

// ---------- بدء التحويل ----------
app.post('/api/convert', async (req, res, next) => {
  try {
    const { fileId, target } = req.body || {};
    if (!fileId) return res.status(400).json({ ok: false, error: 'NO_FILE_ID' });

    const tgt = String((target || 'apk')).toLowerCase();
    if (tgt !== 'apk' && tgt !== 'exe')
      return res.status(400).json({ ok: false, error: 'BAD_TARGET' });

    const file = files.get(fileId);
    if (!file) return res.status(404).json({ ok: false, error: 'FILE_NOT_FOUND' });

    const jobId = nanoid(10);
    const job = {
      status: 'queued',
      target: tgt,
      fileId,
      createdAt: Date.now()
    };
    jobs.set(jobId, job);

    // شغّل التحويل بالخلفية (مبسط الآن)
    runConversion(jobId).catch((e) => {
      const j = jobs.get(jobId);
      if (j) {
        j.status = 'error';
        j.error = e?.message || String(e);
        j.doneAt = Date.now();
        jobs.set(jobId, j);
      }
    });

    return res.json({ ok: true, jobId });
  } catch (e) {
    next(e);
  }
});

// ---------- الاستعلام عن الحالة ----------
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'JOB_NOT_FOUND' });

  return res.json({
    ok: true,
    jobId: req.params.jobId,
    status: job.status,
    target: job.target,
    error: job.error || null,
    createdAt: job.createdAt,
    doneAt: job.doneAt || null,
    // متى يجهز رابط التنزيل
    downloadUrl:
      job.status === 'done'
        ? `${req.protocol}://${req.get('host')}/api/download/${req.params.jobId}`
        : null
  });
});

// ---------- تنزيل الناتج ----------
app.get('/api/download/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'JOB_NOT_FOUND' });
  if (job.status !== 'done')
    return res.status(409).json({ ok: false, error: 'NOT_READY' });

  const filename = job.outputName || `output.${job.target}`;
  return res.download(job.outputPath, filename);
});

// ---------- دالة التحويل (استبدلها لاحقًا بمحركك الحقيقي) ----------
async function runConversion(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('JOB_NOT_FOUND_INTERNAL');

  const file = files.get(job.fileId);
  if (!file) throw new Error('FILE_NOT_FOUND_INTERNAL');

  job.status = 'processing';
  jobs.set(jobId, job);

  // هنا مكانك لإستبدال العملية الحقيقية:
  // مثال: ارسال الملف لمُحوّل خارجي، أو تشغيل سكربت،
  // ثم إعادة المسار الناتج.
  // الآن: ننسخ الملف ونغيّر الامتداد ليعمل التدفق كاملًا.
  const baseName = path.parse(file.name).name || 'app';
  const outName = `${baseName}.${job.target}`;
  const outPath = path.join(OUT_DIR, `${jobId}.${job.target}`);

  // "محاكاة" وقت بناء
  await sleep(800);
  await fsp.copyFile(file.path, outPath);

  job.status = 'done';
  job.outputPath = outPath;
  job.outputName = outName;
  job.doneAt = Date.now();
  jobs.set(jobId, job);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- معالجات الأخطاء ----------
app.use((err, req, res, next) => {
  if (err && err.message === 'CORS_BLOCKED') {
    return res.status(403).json({ ok: false, error: 'CORS_BLOCKED' });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: 'FILE_TOO_LARGE' });
  }
  if (err && err.message === 'UNSUPPORTED_TYPE') {
    return res.status(415).json({ ok: false, error: 'UNSUPPORTED_TYPE' });
  }
  console.error('ERROR:', err);
  return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
});

// ---------- تشغيل الخادم ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Listening on', PORT));
