const express = require('express');
const Announcement = require('../models/Announcement');

const router = express.Router();

// @route   GET /api/announcements
// @desc    获取公告列表（公开）
// @access  Public
router.get('/', async (req, res) => {
  try {
    const lang = req.query.lang || 'zh';
    const items = await Announcement.find({ lang, isActive: true })
      .sort({ order: 1, createdAt: -1 })
      .select('text lang order')
      .lean();

    res.json({ items });
  } catch (error) {
    console.error('获取公告失败:', error);
    res.status(500).json({ error: '获取公告失败' });
  }
});

module.exports = router;
