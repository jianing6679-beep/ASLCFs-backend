const { body, param, query, validationResult } = require('express-validator');
const { isAppId } = require('../utils/ids');

const PUBLIC_EMAIL_DOMAINS = [
  'qq.com',
  '163.com',
  '126.com',
  'yeah.net',
  'sina.com',
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'foxmail.com',
  'icloud.com'
];

const TITLE_OPTIONS = [
  'undergraduate',
  'master',
  'doctoral',
  'postdoc',
  'lecturer',
  'associate_professor',
  'professor',
  'researcher',
  'engineer',
  'other'
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg,
        value: err.value
      }))
    });
  }
  next();
};

const isEducationalEmail = (email = '') => {
  if (!email || !email.includes('@')) return false;
  const domain = email.split('@').pop().trim().toLowerCase();
  return Boolean(domain) && !PUBLIC_EMAIL_DOMAINS.some(item => domain === item || domain.endsWith(`.${item}`));
};

const validateRegister = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be between 3 and 50 characters.')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can contain only letters, numbers, and underscores.')
    .escape(),

  body('email')
    .isEmail()
    .withMessage('Please provide a valid educational email address.')
    .normalizeEmail()
    .isLength({ max: 100 })
    .withMessage('Educational email is too long.')
    .custom(value => {
      if (!isEducationalEmail(value)) {
        throw new Error('Please use a university or institutional email address.');
      }
      return true;
    }),

  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long.')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must include uppercase, lowercase, and a number.'),

  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Password confirmation does not match.');
      }
      return true;
    }),

  body('profile.firstName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('First name must be 50 characters or fewer.')
    .escape(),

  body('profile.lastName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Last name must be 50 characters or fewer.')
    .escape(),

  body('profile.institution')
    .trim()
    .notEmpty()
    .withMessage('Institution is required.')
    .isLength({ max: 100 })
    .withMessage('Institution must be 100 characters or fewer.')
    .escape(),

  body('profile.title')
    .trim()
    .notEmpty()
    .withMessage('Please select a title.')
    .isIn(TITLE_OPTIONS)
    .withMessage('Invalid title option.'),

  body('profile.department')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Department must be 100 characters or fewer.')
    .escape(),

  handleValidationErrors
];

const validateLogin = [
  body('username')
    .trim()
    .notEmpty()
    .withMessage('Username is required.')
    .escape(),

  body('password')
    .notEmpty()
    .withMessage('Password is required.'),

  handleValidationErrors
];

const validateProfileUpdate = [
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),

  body('profile.firstName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('First name must be 50 characters or fewer.')
    .escape(),

  body('profile.lastName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Last name must be 50 characters or fewer.')
    .escape(),

  body('profile.institution')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Institution must be 100 characters or fewer.')
    .escape(),

  body('profile.title')
    .optional()
    .trim()
    .isIn(TITLE_OPTIONS)
    .withMessage('Invalid title option.'),

  body('profile.department')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Department must be 100 characters or fewer.')
    .escape(),

  body('profile.researchInterests')
    .optional()
    .isArray({ max: 10 })
    .withMessage('Research interests can contain at most 10 items.'),

  body('profile.researchInterests.*')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Each research interest must be 100 characters or fewer.')
    .escape(),

  handleValidationErrors
];

const validatePasswordChange = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required.'),

  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long.')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must include uppercase, lowercase, and a number.'),

  body('confirmNewPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('New password confirmation does not match.');
      }
      return true;
    }),

  handleValidationErrors
];

const validateUserId = [
  param('id')
    .custom(value => isAppId(value))
    .withMessage('Invalid user id.'),

  handleValidationErrors
];

const validateQueryParams = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be an integer greater than 0.')
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100.')
    .toInt(),

  query('search')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Search keyword must be 100 characters or fewer.')
    .escape(),

  query('role')
    .optional()
    .isIn(['user', 'admin', 'researcher'])
    .withMessage('Role must be user, admin, or researcher.'),

  handleValidationErrors
];

module.exports = {
  validateRegister,
  validateLogin,
  validateProfileUpdate,
  validatePasswordChange,
  validateUserId,
  validateQueryParams,
  handleValidationErrors
};
