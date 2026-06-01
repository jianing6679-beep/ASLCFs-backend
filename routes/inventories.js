const express = require('express');
const fs = require('fs');
const path = require('path');
const InventoryFile = require('../models/InventoryFile');
const DownloadHistory = require('../models/DownloadHistory');
const { optionalAuth } = require('../middleware/auth');
const { isAppId } = require('../utils/ids');

const router = express.Router();
const backendRoot = path.join(__dirname, '..');
const inventoryRoot = path.resolve(backendRoot, 'uploads', 'inventories');

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const getClientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';

const getEquivalentDatasetKeys = (datasetKey = '') => {
  if (datasetKey === 'other_emission') {
    return ['other_emission', 'industrial_emission', 'traffic_emission'];
  }
  return datasetKey ? [datasetKey] : [];
};

const getInventoryFilePath = (relativePath = '') => {
  const filePath = path.resolve(backendRoot, String(relativePath || ''));
  const relativeToInventoryRoot = path.relative(inventoryRoot, filePath);

  if (relativeToInventoryRoot.startsWith('..') || path.isAbsolute(relativeToInventoryRoot)) {
    return null;
  }

  return filePath;
};

const buildPublicQuery = (query = {}) => {
  const conditions = {
    isPublished: true,
    dataType: 'emission'
  };

  if (query.year) conditions.year = query.year;
  if (query.datasetKey) conditions.datasetKey = { $in: getEquivalentDatasetKeys(String(query.datasetKey)) };
  if (query.category) conditions.category = query.category;
  if (query.subject) conditions.subject = query.subject;
  if (query.scale) conditions.scale = query.scale;

  if (query.keyword) {
    const pattern = escapeRegex(query.keyword.trim());
    conditions.$or = [
      { title: { $regex: pattern, $options: 'i' } },
      { datasetName: { $regex: pattern, $options: 'i' } },
      { description: { $regex: pattern, $options: 'i' } },
      { pollutant: { $regex: pattern, $options: 'i' } },
      { subject: { $regex: pattern, $options: 'i' } },
      { originalFilename: { $regex: pattern, $options: 'i' } }
    ];
  }

  return conditions;
};

router.get('/', async (req, res) => {
  try {
    const items = await InventoryFile.find(buildPublicQuery(req.query))
      .sort({ year: -1, updatedAt: -1, createdAt: -1 })
      .select('dataType datasetKey datasetName title description originalFilename pollutant year category subject period scale version developer size extension downloadCount createdAt updatedAt')
      .lean();

    res.json({ items });
  } catch (error) {
    console.error('获取排放清单失败:', error);
    res.status(500).json({ error: '获取排放清单失败' });
  }
});

router.get('/:id/download', optionalAuth, async (req, res) => {
  try {
    if (!isAppId(req.params.id)) {
      return res.status(404).json({ error: '清单文件不存在' });
    }

    const inventory = await InventoryFile.findOne({
      _id: req.params.id,
      isPublished: true
    }).lean();

    if (!inventory) {
      return res.status(404).json({ error: '清单文件不存在或未发布' });
    }

    const filePath = getInventoryFilePath(inventory.relativePath);
    if (!filePath) {
      return res.status(404).json({ error: '清单文件不存在' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '清单文件不存在' });
    }

    InventoryFile.updateOne({ _id: inventory._id }, { $inc: { downloadCount: 1 } }).catch((error) => {
      console.error('更新下载次数失败:', error);
    });

    if (req.user) {
      DownloadHistory.create({
        user: req.user._id,
        username: req.user.username || '',
        email: req.user.email || '',
        dataType: inventory.dataType || 'emission',
        downloadType: 'single',
        dataTypeLabel: '排放数据',
        datasetKey: inventory.datasetKey || '',
        datasetName: inventory.datasetName || '',
        filename: inventory.originalFilename,
        filePath: inventory.relativePath,
        fileCount: 1,
        fileSize: inventory.size || 0,
        year: inventory.year || '',
        category: inventory.category || '',
        subject: inventory.subject || '',
        scale: inventory.scale || '',
        inventoryId: inventory._id,
        filters: {
          year: inventory.year || '',
          datasetKey: inventory.datasetKey || '',
          datasetName: inventory.datasetName || '',
          category: inventory.category || '',
          subject: inventory.subject || '',
          scale: inventory.scale || ''
        },
        ip: getClientIp(req),
        userAgent: req.get('user-agent') || ''
      }).catch((error) => {
        console.error('记录清单下载历史失败:', error);
      });
    }

    return res.download(filePath, inventory.originalFilename);
  } catch (error) {
    console.error('下载排放清单失败:', error);
    res.status(500).json({ error: '下载排放清单失败' });
  }
});

module.exports = router;
