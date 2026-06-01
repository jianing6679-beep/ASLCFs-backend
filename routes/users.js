const express = require('express');
const User = require('../models/User');
const { auth, adminAuth } = require('../middleware/auth');
const {
  validateUserId,
  validateQueryParams,
  validateProfileUpdate
} = require('../middleware/validation');

const router = express.Router();

// @route   GET /api/users
// @desc    获取用户列表（管理员权限）
// @access  Private (Admin only)
router.get('/', auth, adminAuth, validateQueryParams, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search;
    const role = req.query.role;

    // 构建查询条件
    let query = {};

    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'profile.firstName': { $regex: search, $options: 'i' } },
        { 'profile.lastName': { $regex: search, $options: 'i' } },
        { 'profile.institution': { $regex: search, $options: 'i' } },
        { 'profile.title': { $regex: search, $options: 'i' } }
      ];
    }

    if (role) {
      query.role = role;
    }

    // 计算跳过的记录数
    const skip = (page - 1) * limit;

    // 查询用户
    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // 获取总数
    const total = await User.countDocuments(query);

    res.json({
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalUsers: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('获取用户列表错误:', error);
    res.status(500).json({
      error: '获取用户列表失败'
    });
  }
});

// @route   GET /api/users/:id
// @desc    获取单个用户信息
// @access  Private
router.get('/:id', auth, validateUserId, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({
        error: '用户不存在'
      });
    }

    // 检查权限：用户只能查看自己的信息，管理员可以查看所有
    if (req.user.role !== 'admin' && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({
        error: '无权查看此用户信息'
      });
    }

    res.json({ user });

  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({
      error: '获取用户信息失败'
    });
  }
});

// @route   PUT /api/users/:id
// @desc    更新用户信息
// @access  Private
router.put('/:id', auth, validateUserId, validateProfileUpdate, async (req, res) => {
  try {
    // 检查权限
    if (req.user.role !== 'admin' && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({
        error: '无权修改此用户信息'
      });
    }

    const allowedUpdates = [
      'email',
      'profile.firstName',
      'profile.lastName',
      'profile.institution',
      'profile.title',
      'profile.department',
      'profile.researchInterests'
    ];

    // 管理员可以额外更新角色和状态
    if (req.user.role === 'admin') {
      allowedUpdates.push('role', 'isActive');
    }

    const updates = {};

    // 只允许更新允许的字段
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    // 如果更新邮箱，检查是否已被使用
    if (updates.email) {
      const existingUser = await User.findOne({
        email: updates.email,
        _id: { $ne: req.params.id }
      });
      if (existingUser) {
        return res.status(400).json({
          error: '邮箱已被其他用户使用'
        });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        error: '用户不存在'
      });
    }

    res.json({
      message: '用户信息更新成功',
      user
    });

  } catch (error) {
    console.error('更新用户信息错误:', error);
    res.status(500).json({
      error: '更新用户信息失败'
    });
  }
});

// @route   DELETE /api/users/:id
// @desc    删除用户（软删除，设置isActive为false）
// @access  Private (Admin only)
router.delete('/:id', auth, adminAuth, validateUserId, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        error: '用户不存在'
      });
    }

    // 防止删除自己的账户
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        error: '不能删除自己的账户'
      });
    }

    // 软删除：设置isActive为false
    user.isActive = false;
    await user.save();

    res.json({
      message: '用户已禁用'
    });

  } catch (error) {
    console.error('删除用户错误:', error);
    res.status(500).json({
      error: '删除用户失败'
    });
  }
});

// @route   POST /api/users/:id/activate
// @desc    激活用户账户
// @access  Private (Admin only)
router.post('/:id/activate', auth, adminAuth, validateUserId, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        error: '用户不存在'
      });
    }

    user.isActive = true;
    user.status = 'approved';
    await user.save();

    res.json({
      message: '用户账户已激活',
      user: {
        id: user._id,
        username: user.username,
        isActive: user.isActive
      }
    });

  } catch (error) {
    console.error('激活用户错误:', error);
    res.status(500).json({
      error: '激活用户失败'
    });
  }
});

// @route   GET /api/users/stats/overview
// @desc    获取用户统计信息
// @access  Private (Admin only)
router.get('/stats/overview', auth, adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });
    const adminUsers = await User.countDocuments({ role: 'admin' });
    const researcherUsers = await User.countDocuments({ role: 'researcher' });

    // 最近注册的用户
    const recentUsers = await User.find({ isActive: true })
      .select('username createdAt')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      stats: {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers,
        admins: adminUsers,
        researchers: researcherUsers,
        regularUsers: totalUsers - adminUsers - researcherUsers
      },
      recentUsers
    });

  } catch (error) {
    console.error('获取用户统计错误:', error);
    res.status(500).json({
      error: '获取用户统计失败'
    });
  }
});

module.exports = router;
