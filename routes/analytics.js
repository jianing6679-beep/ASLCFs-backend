const express = require('express');
const DownloadHistory = require('../models/DownloadHistory');
const DownloadLog = require('../models/DownloadLog');
const Citation = require('../models/Citation');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// 管理员：综合统计面板
router.get('/dashboard', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '无权限访问'
      });
    }

    const { startDate, endDate } = req.query;
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // 用户统计
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });
    const usersByTitle = await User.aggregate([
      {
        $group: {
          _id: '$profile.title',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // 下载统计
    const totalDownloads = await DownloadHistory.countDocuments(dateFilter);
    const downloadsByDataType = await DownloadHistory.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$dataType',
          count: { $sum: 1 },
          totalSize: { $sum: '$fileSize' }
        }
      }
    ]);

    // 引用统计
    const totalCitations = await Citation.countDocuments({ status: 'approved' });
    const pendingCitations = await Citation.countDocuments({ status: 'pending' });

    // 活跃用户（下载次数最多）
    const topDownloaders = await DownloadHistory.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$user',
          downloadCount: { $sum: 1 },
          totalSize: { $sum: '$fileSize' }
        }
      },
      { $sort: { downloadCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      { $unwind: '$userInfo' },
      {
        $project: {
          username: '$userInfo.username',
          email: '$userInfo.email',
          institution: '$userInfo.profile.institution',
          title: '$userInfo.profile.title',
          downloadCount: 1,
          totalSize: 1
        }
      }
    ]);

    // 机构统计
    const institutionStats = await User.aggregate([
      { $match: { 'profile.institution': { $exists: true, $ne: '' } } },
      {
        $group: {
          _id: '$profile.institution',
          userCount: { $sum: 1 }
        }
      },
      { $sort: { userCount: -1 } },
      { $limit: 20 }
    ]);

    // 每日下载趋势（最近30天）
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyDownloads = await DownloadHistory.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          byTitle: usersByTitle,
          byInstitution: institutionStats
        },
        downloads: {
          total: totalDownloads,
          byDataType: downloadsByDataType,
          topUsers: topDownloaders,
          dailyTrend: dailyDownloads
        },
        citations: {
          total: totalCitations,
          pending: pendingCitations
        }
      }
    });

  } catch (error) {
    console.error('获取统计面板数据失败:', error);
    res.status(500).json({
      success: false,
      message: '获取统计面板数据失败'
    });
  }
});

// 管理员：用户详细信息（包含下载和引用）
router.get('/users/:userId/details', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '无权限访问'
      });
    }

    const { userId } = req.params;

    // 用户基本信息
    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 下载统计
    const downloadStats = await DownloadHistory.aggregate([
      { $match: { user: user._id } },
      {
        $group: {
          _id: '$dataType',
          count: { $sum: 1 },
          totalSize: { $sum: '$fileSize' }
        }
      }
    ]);

    const totalDownloads = await DownloadHistory.countDocuments({ user: user._id });

    // 最近下载
    const recentDownloads = await DownloadHistory.find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // 引用统计
    const citationStats = await Citation.aggregate([
      { $match: { userId: user._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const citations = await Citation.find({ userId: user._id })
      .sort({ submittedAt: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        user: {
          ...user,
          password: undefined // 不返回密码
        },
        downloads: {
          total: totalDownloads,
          byDataType: downloadStats,
          recent: recentDownloads
        },
        citations: {
          byStatus: citationStats,
          list: citations
        }
      }
    });

  } catch (error) {
    console.error('获取用户详细信息失败:', error);
    res.status(500).json({
      success: false,
      message: '获取用户详细信息失败'
    });
  }
});

// 管理员：导出统计报告
router.get('/export/report', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '无权限访问'
      });
    }

    const { startDate, endDate, format = 'json' } = req.query;
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // 获取所有用户及其下载和引用信息
    const users = await User.find().lean();

    const report = [];
    for (const user of users) {
      const downloads = await DownloadHistory.countDocuments({
        user: user._id,
        ...dateFilter
      });

      const citations = await Citation.countDocuments({
        userId: user._id,
        status: 'approved'
      });

      report.push({
        用户名: user.username,
        邮箱: user.email,
        职称: user.profile?.title || '未填写',
        机构: user.profile?.institution || '未填写',
        部门: user.profile?.department || '未填写',
        研究方向: user.profile?.researchField || '未填写',
        下载次数: downloads,
        引用论文数: citations,
        注册时间: user.createdAt,
        最后登录: user.lastLogin || '未登录'
      });
    }

    if (format === 'csv') {
      // 生成CSV格式
      const headers = Object.keys(report[0] || {});
      const csvRows = [
        headers.join(','),
        ...report.map(row =>
          headers.map(header => {
            const value = row[header];
            return typeof value === 'string' && value.includes(',')
              ? `"${value}"`
              : value;
          }).join(',')
        )
      ];

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=user-report.csv');
      res.send('﻿' + csvRows.join('\n')); // BOM for Excel UTF-8
    } else {
      res.json({
        success: true,
        data: report
      });
    }

  } catch (error) {
    console.error('导出报告失败:', error);
    res.status(500).json({
      success: false,
      message: '导出报告失败'
    });
  }
});

module.exports = router;
