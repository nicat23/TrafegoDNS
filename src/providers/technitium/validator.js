/**
 * Technitium-specific record validation
 */
const logger = require('../../utils/logger');

function validateRecord(record) {
  if (!record.type) throw new Error('Record type is required');
  if (!record.name) throw new Error('Record name is required');
  if (!record.content) throw new Error('Record content is required');

  if (record.type === 'CNAME' && record.name === record.zone) {
    logger.warn('Technitium: CNAME at zone apex is often restricted. Consider ANAME.');
  }

  if (record.ttl && record.ttl < 0) {
    throw new Error('TTL must be a positive integer');
  }
}

module.exports = { validateRecord };