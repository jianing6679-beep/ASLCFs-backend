const express = require('express');
const { body, param, validationResult } = require('express-validator');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { pipeline } = require('stream/promises');
const User = require('../models/User');
const Announcement = require('../models/Announcement');
const InventoryFile = require('../models/InventoryFile');
const DownloadHistory = require('../models/DownloadHistory');
const { auth, adminAuth } = require('../middleware/auth');
const { validateQueryParams } = require('../middleware/validation');
const { sendMail } = require('../config/mailer');
const { reloadWhitelist } = require('../config/whitelist');
const { isSqlMode, getPool } = require('../db/sql');
const { isAppId } = require('../utils/ids');

const router = express.Router();
const backendRoot = path.join(__dirname, '..');
const uploadRoot = path.resolve(backendRoot, 'uploads', 'inventories');

const createVerifyToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return { rawToken, tokenHash, expiresAt };
};

const getVerifyLink = (token) => {
  const base = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  return `${base}/api/auth/verify-email?token=${token}`;
};

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: '参数错误',
      details: errors.array()
    });
    return false;
  }
  return true;
};

const validateAnnouncement = [
  body('text').isString().trim().isLength({ min: 1, max: 200 }).withMessage('公告内容不能为空且不超过200字'),
  body('lang').optional().isIn(['zh', 'en', 'fr', 'es', 'ru', 'ar']).withMessage('语言不合法'),
  body('order').optional().isInt({ min: 0, max: 9999 }).withMessage('顺序需为0-9999'),
  body('isActive').optional().isBoolean().withMessage('isActive需为布尔值')
];

const validateIdParam = (message = '无效ID') => param('id').custom(value => isAppId(value)).withMessage(message);

const INVENTORY_UPLOAD_LIMIT_BYTES = (() => {
  const value = String(process.env.INVENTORY_UPLOAD_LIMIT || '64mb').trim().toLowerCase();
  const match = value.match(/^(\d+)(b|kb|mb|gb)?$/);
  if (!match) return 64 * 1024 * 1024;
  const amount = Number(match[1]);
  const unit = match[2] || 'b';
  const multipliers = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024
  };
  return amount * multipliers[unit];
})();

const INVENTORY_UPLOAD_TYPES = [
    'application/octet-stream',
    'image/tiff',
    'image/geotiff',
    'application/geotiff',
    'text/csv',
    'text/plain',
    'application/json',
    'application/zip',
    'application/x-zip-compressed',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/x-netcdf'
];

const isAllowedUploadContentType = (value = '') => {
  const contentType = String(value || '').split(';')[0].trim().toLowerCase();
  return INVENTORY_UPLOAD_TYPES.includes(contentType);
};

const sanitizeFileName = (value = '') => value
  .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
  .replace(/\s+/g, '_')
  .replace(/-+/g, '-')
  .replace(/_+/g, '_')
  .slice(0, 120);

const normalizeScale = (value = '') => {
  const text = String(value || '').trim().toLowerCase();
  return ['annual', 'monthly', 'daily', 'hourly', 'other', ''].includes(text) ? text : 'annual';
};

const normalizeDataType = (value = '') => {
  const text = String(value || '').trim().toLowerCase();
  return text === 'emission' ? text : 'emission';
};

const sanitizeDatasetKey = (value = '') => sanitizeFileName(String(value || '').trim().toLowerCase())
  .replace(/[^a-z0-9_-]/g, '_')
  .replace(/_+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 80);

const getDefaultDataset = (dataType = 'emission') => {
  return { datasetKey: 'agriculture_emission', datasetName: '农业排放清单' };
};

const getEquivalentDatasetKeys = (datasetKey = '') => {
  if (datasetKey === 'other_emission') {
    return ['other_emission', 'industrial_emission', 'traffic_emission'];
  }
  return datasetKey ? [datasetKey] : [];
};

const normalizeBoolean = (value = '') => ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());

const streamUploadToFile = async (req, absolutePath) => {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength && contentLength > INVENTORY_UPLOAD_LIMIT_BYTES) {
    const error = new Error('上传文件超过大小限制');
    error.status = 413;
    throw error;
  }

  let received = 0;
  req.on('data', (chunk) => {
    received += chunk.length;
    if (received > INVENTORY_UPLOAD_LIMIT_BYTES) {
      req.destroy(Object.assign(new Error('上传文件超过大小限制'), { status: 413 }));
    }
  });

  await pipeline(req, fs.createWriteStream(absolutePath, { flags: 'wx' }));
  return received || contentLength;
};

const buildDataFilePath = ({ dataType, datasetKey, year, category, baseName, extension }) => {
  const safeYear = /^\d{4}$/.test(String(year)) ? String(year) : 'unknown';
  const safeType = normalizeDataType(dataType);
  const safeDataset = sanitizeDatasetKey(datasetKey) || getDefaultDataset(safeType).datasetKey;
  const categoryFolder = 'files';
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const safeBaseName = sanitizeFileName(baseName || 'dataset') || 'dataset';
  const storedFilename = `${timestamp}-${randomSuffix}-${safeBaseName}.${extension}`;
  const absoluteDir = path.join(uploadRoot, safeType, safeDataset, safeYear, categoryFolder);
  const absolutePath = path.join(absoluteDir, storedFilename);
  const relativePath = path.relative(backendRoot, absolutePath).split(path.sep).join('/');

  return {
    absoluteDir,
    absolutePath,
    relativePath,
    storedFilename
  };
};

const getInventoryAbsolutePath = (inventory) => {
  const filePath = path.resolve(backendRoot, String(inventory.relativePath || ''));
  const relativeToUploadRoot = path.relative(uploadRoot, filePath);

  if (relativeToUploadRoot.startsWith('..') || path.isAbsolute(relativeToUploadRoot)) {
    return null;
  }

  return filePath;
};

// @route   GET /api/admin/registrations
// @desc    获取待审核用户列表
// @access  Admin only
router.get('/registrations', auth, adminAuth, validateQueryParams, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const allowedStatus = ['pending', 'approved', 'rejected'];
    const status = allowedStatus.includes(req.query.status) ? req.query.status : 'pending';
    const search = req.query.search;

    const query = { status };
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'profile.institution': { $regex: search, $options: 'i' } },
        { 'profile.title': { $regex: search, $options: 'i' } }
      ];
    }
    const skip = (page - 1) * limit;

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await User.countDocuments(query);

    res.json({
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalUsers: total
      }
    });
  } catch (error) {
    console.error('获取待审核用户失败:', error);
    res.status(500).json({ error: '获取待审核用户失败' });
  }
});

// @route   POST /api/admin/whitelist/reload
// @desc    热更新白名单
// @access  Admin only
router.post('/whitelist/reload', auth, adminAuth, (req, res) => {
  try {
    const list = reloadWhitelist();
    res.json({
      message: '白名单已刷新',
      count: list.length,
      domains: list
    });
  } catch (error) {
    console.error('刷新白名单失败:', error);
    res.status(500).json({ error: '刷新白名单失败' });
  }
});

// @route   GET /api/admin/announcements
// @desc    获取公告列表（管理端）
// @access  Admin only
router.get('/announcements', auth, adminAuth, async (req, res) => {
  try {
    const lang = req.query.lang;
    const isActive = req.query.isActive;
    const query = {};
    if (lang) query.lang = lang;
    if (isActive === 'true' || isActive === 'false') {
      query.isActive = isActive === 'true';
    }

    const items = await Announcement.find(query)
      .sort({ order: 1, createdAt: -1 })
      .lean();

    res.json({ items });
  } catch (error) {
    console.error('获取公告失败:', error);
    res.status(500).json({ error: '获取公告失败' });
  }
});

// @route   POST /api/admin/announcements
// @desc    创建公告
// @access  Admin only
router.post('/announcements', auth, adminAuth, ...validateAnnouncement, async (req, res) => {
  if (!handleValidation(req, res)) return;
  try {
    const { text, lang = 'zh', order = 0, isActive = true } = req.body;
    const item = await Announcement.create({ text, lang, order, isActive });
    res.status(201).json({ message: '公告已创建', item });
  } catch (error) {
    console.error('创建公告失败:', error);
    res.status(500).json({ error: '创建公告失败' });
  }
});

// @route   PUT /api/admin/announcements/:id
// @desc    更新公告
// @access  Admin only
router.put(
  '/announcements/:id',
  auth,
  adminAuth,
  validateIdParam('无效公告ID'),
  ...validateAnnouncement,
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const { text, lang = 'zh', order = 0, isActive = true } = req.body;
      const item = await Announcement.findByIdAndUpdate(
        req.params.id,
        { text, lang, order, isActive },
        { new: true }
      );
      if (!item) {
        return res.status(404).json({ error: '公告不存在' });
      }
      res.json({ message: '公告已更新', item });
    } catch (error) {
      console.error('更新公告失败:', error);
      res.status(500).json({ error: '更新公告失败' });
    }
  }
);

// @route   DELETE /api/admin/announcements/:id
// @desc    删除公告
// @access  Admin only
router.delete(
  '/announcements/:id',
  auth,
  adminAuth,
  validateIdParam('无效公告ID'),
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    try {
      const item = await Announcement.findByIdAndDelete(req.params.id);
      if (!item) {
        return res.status(404).json({ error: '公告不存在' });
      }
      res.json({ message: '公告已删除' });
    } catch (error) {
      console.error('删除公告失败:', error);
      res.status(500).json({ error: '删除公告失败' });
    }
  }
);

// @route   GET /api/admin/inventories
// @desc    获取数据文件列表（管理端）
// @access  Admin only
router.get('/inventories', auth, adminAuth, async (req, res) => {
  try {
    const items = await InventoryFile.find({})
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'username email')
      .lean();

    res.json({ items });
  } catch (error) {
    console.error('获取数据文件列表失败:', error);
    res.status(500).json({ error: '获取数据文件列表失败' });
  }
});

router.get('/download-history', auth, adminAuth, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const query = {};

    if (req.query.user) query.user = req.query.user;
    if (req.query.dataType) query.dataType = String(req.query.dataType);
    if (req.query.year) query.year = String(req.query.year);
    if (req.query.category) query.category = String(req.query.category);
    if (req.query.keyword) {
      const pattern = String(req.query.keyword).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { username: { $regex: pattern, $options: 'i' } },
        { email: { $regex: pattern, $options: 'i' } },
        { filename: { $regex: pattern, $options: 'i' } },
        { datasetName: { $regex: pattern, $options: 'i' } },
        { subject: { $regex: pattern, $options: 'i' } }
      ];
    }

    const [items, total] = await Promise.all([
      DownloadHistory.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      DownloadHistory.countDocuments(query)
    ]);

    res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  } catch (error) {
    console.error('获取下载历史失败:', error);
    res.status(500).json({ error: '获取下载历史失败' });
  }
});

router.get('/download-user-stats', auth, adminAuth, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;
    const keyword = String(req.query.keyword || '').trim();
    const filters = {
      dateFrom: String(req.query.dateFrom || '').trim(),
      dateTo: String(req.query.dateTo || '').trim(),
      datasetKey: String(req.query.datasetKey || '').trim(),
      year: String(req.query.year || '').trim()
    };

    if (isSqlMode()) {
      const db = getPool();
      const where = [];
      const params = [];

      if (filters.dateFrom) {
        where.push('d.createdAt >= ?');
        params.push(new Date(filters.dateFrom));
      }
      if (filters.dateTo) {
        where.push('d.createdAt <= ?');
        params.push(new Date(`${filters.dateTo}T23:59:59`));
      }
      if (filters.datasetKey) {
        const datasetKeys = getEquivalentDatasetKeys(filters.datasetKey);
        where.push(`d.datasetKey IN (${datasetKeys.map(() => '?').join(',')})`);
        params.push(...datasetKeys);
      }
      if (filters.year) {
        where.push('d.year = ?');
        params.push(filters.year);
      }
      if (keyword) {
        const like = `%${keyword}%`;
        where.push(`(
          d.username LIKE ? OR d.email LIKE ? OR d.datasetName LIKE ? OR
          JSON_UNQUOTE(JSON_EXTRACT(u.profile, '$.firstName')) LIKE ? OR
          JSON_UNQUOTE(JSON_EXTRACT(u.profile, '$.lastName')) LIKE ? OR
          JSON_UNQUOTE(JSON_EXTRACT(u.profile, '$.institution')) LIKE ? OR
          JSON_UNQUOTE(JSON_EXTRACT(u.profile, '$.title')) LIKE ? OR
          JSON_UNQUOTE(JSON_EXTRACT(u.profile, '$.advisor')) LIKE ?
        )`);
        params.push(like, like, like, like, like, like, like, like);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const groupSql = `
        FROM download_histories d
        LEFT JOIN users u ON d.user = u._id
        ${whereSql}
        GROUP BY d.user, d.username, d.email, u.username, u.email
      `;

      const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM (SELECT d.user ${groupSql}) grouped`, params);
      const [rows] = await db.query(`
        SELECT
          d.user AS userId,
          COALESCE(u.username, d.username) AS username,
          COALESCE(u.email, d.email) AS email,
          JSON_UNQUOTE(JSON_EXTRACT(u.profile, '$.firstName')) AS firstName,
          JSON_UNQUOTE(JSON_EXTRACT(u.profile, '$.lastName')) AS lastName,
          JSON_UNQUOTE(JSON_EXTRACT(u.profile, '$.institution')) AS institution,
          JSON_UNQUOTE(JSON_EXTRACT(u.profile, '$.title')) AS title,
          JSON_UNQUOTE(JSON_EXTRACT(u.profile, '$.advisor')) AS advisor,
          COUNT(d._id) AS downloadCount,
          COALESCE(SUM(d.fileCount), 0) AS fileCount,
          GROUP_CONCAT(DISTINCT NULLIF(d.datasetName, '') ORDER BY d.datasetName SEPARATOR ', ') AS datasets,
          MAX(d.createdAt) AS lastDownloadAt
        ${groupSql}
        ORDER BY lastDownloadAt DESC
        LIMIT ? OFFSET ?
      `, [...params, limit, offset]);

      const items = rows.map(row => ({
        userId: row.userId || '',
        username: row.username || '',
        email: row.email || '',
        name: [row.firstName, row.lastName].filter(Boolean).join(' ') || row.username || '',
        institution: row.institution || '',
        title: row.title || '',
        advisor: row.advisor || '',
        downloadCount: Number(row.downloadCount || 0),
        fileCount: Number(row.fileCount || 0),
        datasets: row.datasets ? String(row.datasets).split(', ').filter(Boolean) : [],
        lastDownloadAt: row.lastDownloadAt
      }));

      const total = Number(countRows[0]?.total || 0);
      return res.json({
        items,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
      });
    }

    const query = {};
    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) query.createdAt.$lte = new Date(`${filters.dateTo}T23:59:59`);
    }
    if (filters.datasetKey) query.datasetKey = { $in: getEquivalentDatasetKeys(filters.datasetKey) };
    if (filters.year) query.year = filters.year;
    const histories = await DownloadHistory.find(query).sort({ createdAt: -1 }).lean();
    const userIds = [...new Set(histories.map(item => String(item.user || '')).filter(Boolean))];
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } }).select('-password').lean()
      : [];
    const userMap = new Map(users.map(user => [String(user._id), user]));
    const grouped = new Map();

    histories.forEach((item) => {
      const key = String(item.user || item.email || item.username || 'anonymous');
      const user = userMap.get(String(item.user || '')) || {};
      const profile = user.profile || {};
      const entry = grouped.get(key) || {
        userId: item.user || '',
        username: user.username || item.username || '',
        email: user.email || item.email || '',
        name: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || user.username || item.username || '',
        institution: profile.institution || '',
        title: profile.title || '',
        advisor: profile.advisor || '',
        downloadCount: 0,
        fileCount: 0,
        datasets: new Set(),
        lastDownloadAt: item.createdAt
      };
      entry.downloadCount += 1;
      entry.fileCount += Number(item.fileCount || 1);
      if (item.datasetName) entry.datasets.add(item.datasetName);
      if (!entry.lastDownloadAt || new Date(item.createdAt) > new Date(entry.lastDownloadAt)) {
        entry.lastDownloadAt = item.createdAt;
      }
      grouped.set(key, entry);
    });

    let items = Array.from(grouped.values()).map(item => ({
      ...item,
      datasets: Array.from(item.datasets)
    }));

    if (keyword) {
      const lower = keyword.toLowerCase();
      items = items.filter(item => [
        item.name,
        item.username,
        item.email,
        item.institution,
        item.title,
        item.advisor,
        item.datasets.join(' ')
      ].join(' ').toLowerCase().includes(lower));
    }

    items.sort((a, b) => new Date(b.lastDownloadAt || 0) - new Date(a.lastDownloadAt || 0));
    const total = items.length;
    items = items.slice(offset, offset + limit);

    res.json({
      items,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (error) {
    console.error('Get download user stats error:', error);
    res.status(500).json({ error: '获取下载用户统计失败' });
  }
});

// @route   POST /api/admin/inventories/upload
// @desc    上传数据文件
// @access  Admin only
router.post('/inventories/upload', auth, adminAuth, async (req, res) => {
  let pathInfo = null;

  try {
    if (!isAllowedUploadContentType(req.headers['content-type'])) {
      return res.status(415).json({ error: '????????' });
    }

    const originalFilename = String(req.query.originalFilename || '').trim();
    if (!originalFilename) {
      return res.status(400).json({ error: '???????' });
    }

    const extension = path.extname(originalFilename).replace('.', '').toLowerCase();
    const dataType = normalizeDataType(req.query.dataType);
    const allowedExtensions = ['tif', 'tiff'];
    if (!allowedExtensions.includes(extension)) {
      return res.status(400).json({
        error: '????????? GeoTIFF ???.tif / .tiff?'
      });
    }

    const defaultDataset = getDefaultDataset(dataType);
    const datasetKey = sanitizeDatasetKey(req.query.datasetKey) || defaultDataset.datasetKey;
    const datasetName = String(req.query.datasetName || defaultDataset.datasetName).trim() || defaultDataset.datasetName;
    const category = String(req.query.category || '').trim();

    const year = String(req.query.year || '').trim();
    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ error: '????? 4 ???' });
    }

    const title = String(req.query.title || path.parse(originalFilename).name).trim();
    const pollutant = String(req.query.pollutant || '').trim();
    const subject = String(req.query.subject || '').trim();
    const period = String(req.query.period || '').trim() || 'Annual';
    const scale = normalizeScale(String(req.query.scale || 'annual'));
    const version = String(req.query.version || 'v1').trim() || 'v1';
    const description = String(req.query.description || '').trim();
    const mimeType = String(req.query.mimeType || req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
    const isPublished = normalizeBoolean(req.query.publish);

    pathInfo = buildDataFilePath({
      dataType,
      datasetKey,
      year,
      category,
      baseName: title || path.parse(originalFilename).name,
      extension
    });

    await fsp.mkdir(pathInfo.absoluteDir, { recursive: true });
    const size = await streamUploadToFile(req, pathInfo.absolutePath);
    if (!size) {
      await fsp.unlink(pathInfo.absolutePath).catch(() => {});
      return res.status(400).json({ error: '??????????' });
    }

    const item = await InventoryFile.create({
      dataType,
      datasetKey,
      datasetName,
      title,
      description,
      originalFilename,
      storedFilename: pathInfo.storedFilename,
      relativePath: pathInfo.relativePath,
      mimeType,
      extension,
      size,
      pollutant,
      year,
      category,
      subject,
      period,
      scale,
      version,
      developer: String(req.query.developer || '???????').trim() || '???????',
      metadata: {
        dataType,
        datasetKey,
        datasetName,
        uploadedAs: dataType
      },
      isPublished,
      uploadedBy: req.user._id
    });

    res.status(201).json({
      message: isPublished ? '????????' : '??????????',
      item
    });
  } catch (error) {
    if (pathInfo && pathInfo.absolutePath) {
      await fsp.unlink(pathInfo.absolutePath).catch(() => {});
    }
    console.error('????????:', error);
    res.status(error.status || 500).json({
      error: error.status === 413 ? '??????????' : '????????'
    });
  }
});

router.put(
  '/inventories/:id/publish',
  auth,
  adminAuth,
  validateIdParam('无效的清单ID'),
  async (req, res) => {
    if (!handleValidation(req, res)) return;

    try {
      const item = await InventoryFile.findByIdAndUpdate(
        req.params.id,
        { isPublished: true },
        { new: true }
      );

      if (!item) {
        return res.status(404).json({ error: '清单文件不存在' });
      }

      res.json({ message: '文件已发布', item });
    } catch (error) {
      console.error('发布排放清单失败:', error);
      res.status(500).json({ error: '发布排放清单失败' });
    }
  }
);

// @route   PUT /api/admin/inventories/:id/unpublish
// @desc    取消发布排放清单
// @access  Admin only
router.put(
  '/inventories/:id/unpublish',
  auth,
  adminAuth,
  validateIdParam('无效的清单ID'),
  async (req, res) => {
    if (!handleValidation(req, res)) return;

    try {
      const item = await InventoryFile.findByIdAndUpdate(
        req.params.id,
        { isPublished: false },
        { new: true }
      );

      if (!item) {
        return res.status(404).json({ error: '清单文件不存在' });
      }

      res.json({ message: '文件已取消发布', item });
    } catch (error) {
      console.error('取消发布排放清单失败:', error);
      res.status(500).json({ error: '取消发布排放清单失败' });
    }
  }
);

// @route   DELETE /api/admin/inventories/:id
// @desc    删除排放清单
// @access  Admin only
router.delete(
  '/inventories/:id',
  auth,
  adminAuth,
  validateIdParam('????? ID'),
  async (req, res) => {
    if (!handleValidation(req, res)) return;

    try {
      const item = await InventoryFile.findById(req.params.id);
      if (!item) {
        return res.status(404).json({ error: '???????' });
      }

      const filePath = getInventoryAbsolutePath(item);
      if (!filePath) {
        return res.status(400).json({ error: '????????????' });
      }

      if (fs.existsSync(filePath)) {
        await fsp.unlink(filePath);
      }

      await InventoryFile.findByIdAndDelete(req.params.id);

      res.json({ message: '?????' });
    } catch (error) {
      console.error('????????:', error);
      res.status(500).json({ error: '????????' });
    }
  }
);

router.post(
  '/registrations/approve',
  auth,
  adminAuth,
  body('ids').isArray({ min: 1 }).withMessage('ids 必须是非空数组'),
  body('ids.*').custom(value => isAppId(value)).withMessage('无效用户ID'),
  async (req, res) => {
    if (!handleValidation(req, res)) return;

    const ids = req.body.ids;
    const now = new Date();

    const result = await User.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: 'approved',
          isActive: true,
          approvedAt: now,
          approvedBy: req.user.username
        },
        $unset: { rejectedReason: 1, rejectedAt: 1, rejectedBy: 1 }
      }
    );

    // 发送通知邮件（若配置了SMTP）
    const approvedUsers = await User.find({ _id: { $in: ids } }).select('email username emailVerified');
    for (const user of approvedUsers) {
      let verifyLink = null;
      if (!user.emailVerified) {
        const { rawToken, tokenHash, expiresAt } = createVerifyToken();
        user.emailVerifyToken = tokenHash;
        user.emailVerifyExpires = expiresAt;
        await user.save();
        verifyLink = getVerifyLink(rawToken);
      }

      await sendMail({
        to: user.email,
        subject: '账户审核通过通知',
        text: verifyLink
          ? `您好，${user.username}，您的账户已通过审核，请先验证邮箱：${verifyLink}`
          : `您好，${user.username}，您的账户已通过审核，可直接登录系统使用。`,
        html: verifyLink
          ? `<p>您好，${user.username}，</p><p>您的账户已通过审核，请先验证邮箱：</p><p><a href="${verifyLink}">${verifyLink}</a></p>`
          : `<p>您好，${user.username}，</p><p>您的账户已通过审核，可直接登录系统使用。</p>`
      });
    }

    res.json({
      message: '批量通过成功',
      modified: result.modifiedCount || 0
    });
  }
);

// @route   POST /api/admin/registrations/reject
// @desc    批量拒绝注册申请
// @access  Admin only
router.post(
  '/registrations/reject',
  auth,
  adminAuth,
  body('ids').isArray({ min: 1 }).withMessage('ids 必须是非空数组'),
  body('ids.*').custom(value => isAppId(value)).withMessage('无效用户ID'),
  body('reason').optional().isLength({ max: 200 }).withMessage('拒绝原因最多200字符'),
  async (req, res) => {
    if (!handleValidation(req, res)) return;

    const ids = req.body.ids;
    const reason = req.body.reason || '未通过审核';
    const now = new Date();

    const result = await User.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: 'rejected',
          isActive: false,
          rejectedReason: reason,
          rejectedAt: now,
          rejectedBy: req.user.username
        }
      }
    );

    // 发送通知邮件（若配置了SMTP）
    const rejectedUsers = await User.find({ _id: { $in: ids } }).select('email username');
    for (const user of rejectedUsers) {
      await sendMail({
        to: user.email,
        subject: '账户审核未通过通知',
        text: `您好，${user.username}，您的注册申请未通过审核。原因：${reason}`,
        html: `<p>您好，${user.username}，</p><p>您的注册申请未通过审核。</p><p>原因：${reason}</p>`
      });
    }

    res.json({
      message: '批量拒绝成功',
      modified: result.modifiedCount || 0
    });
  }
);

module.exports = router;
