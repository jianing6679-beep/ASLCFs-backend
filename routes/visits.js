const express = require('express');
const SiteVisit = require('../models/SiteVisit');

const router = express.Router();
const VISIT_BASE_COUNT = 6124;
const VISIT_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

const getClientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
const sanitizeVisitorId = (value) => String(value || '').trim().slice(0, 80);

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
    const visitorId = sanitizeVisitorId(req.body?.visitorId);
    const since = new Date(Date.now() - VISIT_DEDUPE_WINDOW_MS);
    let recorded = true;

    if (visitorId) {
      const recentVisit = await SiteVisit.exists({
        visitorId,
        createdAt: { $gte: since }
      });

      recorded = !recentVisit;
    }

    if (!visitorId || recorded) {
      await SiteVisit.create({
        page: String(req.body?.page || ''),
        path: String(req.body?.path || ''),
        referrer: String(req.body?.referrer || ''),
        visitorId,
        ip: getClientIp(req),
        userAgent: req.get('user-agent') || ''
      });
    }

    const count = await getVisitCount();
    count.recorded = recorded;

    res.json(count);
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
