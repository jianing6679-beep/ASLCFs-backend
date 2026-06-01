if (String(process.env.DB_MODE || '').toLowerCase() === 'sql') {
  module.exports = require('./sql/User');
  return;
}

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, '用户名不能为空'],
    unique: true,
    trim: true,
    minlength: [3, '用户名至少 3 个字符'],
    maxlength: [50, '用户名最多 50 个字符'],
    match: [/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字和下划线']
  },
  email: {
    type: String,
    required: [true, '邮箱不能为空'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, '请输入有效的邮箱地址']
  },
  password: {
    type: String,
    required: [true, '密码不能为空'],
    minlength: [6, '密码至少 6 个字符'],
    select: false
  },
  role: {
    type: String,
    enum: {
      values: ['user', 'admin', 'researcher'],
      message: '角色必须是 user、admin 或 researcher'
    },
    default: 'user'
  },
  profile: {
    firstName: {
      type: String,
      trim: true,
      maxlength: [50, '名字最多 50 个字符']
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: [50, '姓氏最多 50 个字符']
    },
    institution: {
      type: String,
      trim: true,
      maxlength: [100, '机构名称最多 100 个字符']
    },
    title: {
      type: String,
      enum: {
        values: ['undergraduate', 'master', 'doctoral', 'postdoc', 'lecturer', 'associate_professor', 'professor', 'researcher', 'engineer', 'other'],
        message: '职称不在允许范围内'
      }
    },
    department: {
      type: String,
      trim: true,
      maxlength: [100, '部门名称最多 100 个字符']
    },
    researchInterests: [{
      type: String,
      trim: true,
      maxlength: [100, '研究兴趣最多 100 个字符']
    }]
  },
  isActive: {
    type: Boolean,
    default: true
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerifyToken: {
    type: String,
    select: false
  },
  emailVerifyExpires: {
    type: Date,
    select: false
  },
  passwordResetToken: {
    type: String,
    select: false
  },
  passwordResetExpires: {
    type: Date,
    select: false
  },
  status: {
    type: String,
    enum: {
      values: ['pending', 'approved', 'rejected'],
      message: '状态必须是 pending、approved 或 rejected'
    },
    default: 'approved'
  },
  approvedAt: {
    type: Date
  },
  approvedBy: {
    type: String,
    trim: true
  },
  rejectedReason: {
    type: String,
    trim: true,
    maxlength: [200, '拒绝原因最多 200 个字符']
  },
  rejectedAt: {
    type: Date
  },
  rejectedBy: {
    type: String,
    trim: true
  },
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

userSchema.virtual('fullName').get(function() {
  if (this.profile.firstName && this.profile.lastName) {
    return `${this.profile.firstName} ${this.profile.lastName}`;
  }
  return this.username;
});

userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ createdAt: -1 });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

userSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

userSchema.methods.incLoginAttempts = function() {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 }
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  if (this.loginAttempts + 1 >= 8 && !this.isLocked()) {
    updates.$set = {
      lockUntil: Date.now() + 2 * 60 * 60 * 1000
    };
  }

  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 },
    $set: { lastLogin: new Date() }
  });
};

userSchema.statics.findByCredentials = function(username, password) {
  return this.findOne({ username })
    .select('+password')
    .then(user => {
      if (!user) {
        throw new Error('用户不存在');
      }

      if (user.status && user.status !== 'approved') {
        throw new Error('账号待审核或已拒绝');
      }

      if (user.isActive === false) {
        throw new Error('账号已被禁用');
      }

      if (user.emailVerified === false) {
        throw new Error('邮箱未验证');
      }

      if (user.isLocked()) {
        throw new Error('账号已被锁定，请稍后再试');
      }

      return user.comparePassword(password).then(isMatch => {
        if (!isMatch) {
          user.incLoginAttempts();
          throw new Error('密码错误');
        }

        user.resetLoginAttempts();
        return user;
      });
    });
};

module.exports = mongoose.model('User', userSchema);
