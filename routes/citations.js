const express = require('express');
const Citation = require('../models/Citation');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// 用户提交引用信息
router.post('/', auth, async (req, res) => {
  try {
    const {
      paperTitle,
      journalName,
      publicationYear,
      doi,
      authors,
      volume,
      issue,
      pages,
      dataTypes,
      abstract
    } = req.body;

    // 验证必填字段
    if (!paperTitle || !journalName || !publicationYear || !authors) {
      return res.status(400).json({
        success: false,
        message: '请填写所有必填字段'
      });
    }

    // 验证年份
    if (publicationYear < 2000 || publicationYear > 2100) {
      return res.status(400).json({
        success: false,
        message: '发表年份无效'
      });
    }

    const citation = new Citation({
      userId: req.user._id,
      paperTitle,
      journalName,
      publicationYear,
      doi,
      authors,
      volume,
      issue,
      pages,
      dataTypes: dataTypes || [],
      abstract
    });

    await citation.save();

    res.status(201).json({
      success: true,
      message: '引用信息提交成功，等待审核',
      data: citation
    });

  } catch (error) {
    console.error('提交引用信息失败:', error);
    res.status(500).json({
      success: false,
      message: '提交引用信息失败'
    });
  }
});

// 用户查看自己的引用记录
router.get('/my-citations', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;

    const query = { userId: req.user._id };
    if (status) {
      query.status = status;
    }

    const citations = await Citation.find(query)
      .sort({ submittedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await Citation.countDocuments(query);

    res.json({
      success: true,
      data: citations,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count
    });

  } catch (error) {
    console.error('获取引用记录失败:', error);
    res.status(500).json({
      success: false,
      message: '获取引用记录失败'
    });
  }
});

// 获取已批准的引用列表（公开）
router.get('/approved', async (req, res) => {
  try {
    const { page = 1, limit = 50, dataType } = req.query;

    const query = { status: 'approved' };
    if (dataType) {
      query.dataTypes = dataType;
    }

    const citations = await Citation.find(query)
      .sort({ publicationYear: -1, submittedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('userId', 'username profile.institution profile.title')
      .lean();

    const count = await Citation.countDocuments(query);

    res.json({
      success: true,
      data: citations,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count
    });

  } catch (error) {
    console.error('获取已批准引用失败:', error);
    res.status(500).json({
      success: false,
      message: '获取已批准引用失败'
    });
  }
});

// 管理员：获取所有引用（待审核）
router.get('/admin/all', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '无权限访问'
      });
    }

    const { page = 1, limit = 20, status } = req.query;

    const query = {};
    if (status) {
      query.status = status;
    }

    const citations = await Citation.find(query)
      .sort({ submittedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('userId', 'username email profile')
      .lean();

    const count = await Citation.countDocuments(query);

    res.json({
      success: true,
      data: citations,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count
    });

  } catch (error) {
    console.error('获取引用列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取引用列表失败'
    });
  }
});

// 管理员：审核引用
router.patch('/admin/:citationId/review', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '无权限访问'
      });
    }

    const { citationId } = req.params;
    const { status, reviewNote } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: '无效的审核状态'
      });
    }

    const citation = await Citation.findByIdAndUpdate(
      citationId,
      {
        status,
        reviewNote
      },
      { new: true }
    );

    if (!citation) {
      return res.status(404).json({
        success: false,
        message: '引用记录不存在'
      });
    }

    res.json({
      success: true,
      message: `引用已${status === 'approved' ? '批准' : '拒绝'}`,
      data: citation
    });

  } catch (error) {
    console.error('审核引用失败:', error);
    res.status(500).json({
      success: false,
      message: '审核引用失败'
    });
  }
});

// 管理员：引用统计
router.get('/admin/stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '无权限访问'
      });
    }

    // 按数据类型统计
    const byDataType = await Citation.aggregate([
      { $match: { status: 'approved' } },
      { $unwind: '$dataTypes' },
      {
        $group: {
          _id: '$dataTypes',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // 按年份统计
    const byYear = await Citation.aggregate([
      { $match: { status: 'approved' } },
      {
        $group: {
          _id: '$publicationYear',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: -1 } }
    ]);

    // 按期刊统计
    const byJournal = await Citation.aggregate([
      { $match: { status: 'approved' } },
      {
        $group: {
          _id: '$journalName',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // 总体统计
    const totalStats = await Citation.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        byDataType,
        byYear,
        byJournal,
        totalStats
      }
    });

  } catch (error) {
    console.error('获取引用统计失败:', error);
    res.status(500).json({
      success: false,
      message: '获取引用统计失败'
    });
  }
});

module.exports = router;
