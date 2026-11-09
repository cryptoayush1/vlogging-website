const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Relay-Secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {}
  }
  payload = payload || {};

  const secret = req.headers['x-relay-secret'] || payload.secret;
  if (secret !== 'field_notes_secure_relay_2026') {
    return res.status(403).json({ error: 'Invalid relay secret' });
  }

  const { to, subject, body } = payload;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER || 'vlogingwebsite@gmail.com',
      pass: (process.env.SMTP_PASS || 'uxendqgrtentfkzh').replace(/\s+/g, ''),
    },
  });

  try {
    await transporter.sendMail({
      from: '"Field Notes Studio" <vlogingwebsite@gmail.com>',
      to,
      subject,
      text: body,
    });
    return res.status(200).json({ success: true, message: `Email delivered to ${to}` });
  } catch (err) {
    console.error('Nodemailer delivery error:', err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
};
