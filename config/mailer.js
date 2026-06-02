const nodemailer = require('nodemailer');

let cachedTransporter = null;

const getMailerConfig = () => ({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 0),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS
});

const isMailerConfigured = () => {
  const { host, port, user, pass } = getMailerConfig();
  return Boolean(host && port && user && pass);
};

const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;

  const { host, port, user, pass } = getMailerConfig();

  if (!host || !port || !user || !pass) {
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  return cachedTransporter;
};

const sendMail = async ({ to, subject, html, text }) => {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('SMTP 未配置，跳过邮件发送');
    return { skipped: true };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return transporter.sendMail({ from, to, subject, html, text });
};

module.exports = { isMailerConfigured, sendMail };
