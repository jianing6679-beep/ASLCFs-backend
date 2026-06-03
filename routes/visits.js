const express = require('express');
const SiteVisit = require('../models/SiteVisit');

const router = express.Router();
const VISIT_BASE_COUNT = 6124;

const getClientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';

const getVisitCount = async () => {
  const actualCount = await SiteVisit.countDocuments();
  return {
    baseCount: VISIT_BASE_COUNT,
    actualCount,
    totalCount: VISIT_BASE_COUNT + actualCount
  };
};

router.post('/visit', async (req, res) => {
  try {
    await SiteVisit.create({
      page: String(req.body?.page || ''),
      path: String(req.body?.path || ''),
      referrer: String(req.body?.referrer || ''),
      ip: getClientIp(req),
      userAgent: req.get('user-agent') || ''
    });

    res.json(await getVisitCount());
  } catch (error) {
    console.error('Record site visit error:', error);
    res.status(500).json({ error: 'Unable to record site visit.' });
  }
});

router.get('/visit-count', async (req, res) => {
  try {
    res.json(await getVisitCount());
  } catch (error) {
    console.error('Get site visit count error:', error);
    res.status(500).json({ error: 'Unable to get site visit count.' });
  }
});

module.exports = router;
