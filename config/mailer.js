const nodemailer = require('nodemailer');

let cachedTransporter = null;

const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 0);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

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

module.exports = { sendMail };
