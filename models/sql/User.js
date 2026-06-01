const bcrypt = require('bcryptjs');
const { createModel, SqlDocument } = require('./query');

const fields = [
  '_id', 'username', 'email', 'password', 'role', 'profile', 'isActive', 'emailVerified',
  'emailVerifyToken', 'emailVerifyExpires', 'passwordResetToken', 'passwordResetExpires',
  'status', 'approvedAt', 'approvedBy', 'rejectedReason', 'rejectedAt', 'rejectedBy',
  'lastLogin', 'loginAttempts', 'lockUntil', 'createdAt', 'updatedAt'
];

class UserDocument extends SqlDocument {
  async save() {
    if (this.password && !String(this.password).startsWith('$2')) {
      const salt = await bcrypt.genSalt(12);
      this.password = await bcrypt.hash(this.password, salt);
    }
    this.email = String(this.email || '').trim().toLowerCase();
    this.role = this.role || 'user';
    this.profile = this.profile || {};
    this.status = this.status || 'approved';
    this.isActive = this.isActive !== undefined ? this.isActive : true;
    this.emailVerified = this.emailVerified !== undefined ? this.emailVerified : false;
    this.loginAttempts = Number(this.loginAttempts || 0);
    return super.save();
  }

  comparePassword(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password || '');
  }

  isLocked() {
    return !!(this.lockUntil && new Date(this.lockUntil).getTime() > Date.now());
  }

  incLoginAttempts() {
    if (this.lockUntil && new Date(this.lockUntil).getTime() < Date.now()) {
      return this.updateOne({
        $unset: { lockUntil: 1 },
        $set: { loginAttempts: 1 }
      });
    }

    const updates = { $inc: { loginAttempts: 1 } };
    if (Number(this.loginAttempts || 0) + 1 >= 8 && !this.isLocked()) {
      updates.$set = { lockUntil: new Date(Date.now() + 2 * 60 * 60 * 1000) };
    }
    return this.updateOne(updates);
  }

  resetLoginAttempts() {
    return this.updateOne({
      $unset: { loginAttempts: 1, lockUntil: 1 },
      $set: { lastLogin: new Date() }
    });
  }
}

const User = createModel({
  table: 'users',
  fields,
  DocumentClass: UserDocument
});

User.findByCredentials = async function findByCredentials(username, password) {
  const user = await User.findOne({ username }).select('+password');
  if (!user) throw new Error('用户不存在');
  if (user.status && user.status !== 'approved') throw new Error('账户待审核或已拒绝');
  if (user.isActive === false) throw new Error('账户已被禁用');
  if (user.emailVerified === false) throw new Error('邮箱未验证');
  if (user.isLocked()) throw new Error('账户已被锁定，请稍后再试');

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    user.incLoginAttempts();
    throw new Error('密码错误');
  }
  await user.resetLoginAttempts();
  return user;
};

module.exports = User;
