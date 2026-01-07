/**
 * Technitium record format converter utilities
 */
const logger = require('../../utils/logger');

function convertToTechnitiumFormat(record, zone) {
  logger.trace(`technitium.converter: Converting record: ${record.name}`);
  
  const params = {
    zone: zone,
    domain: record.name,
    type: record.type,
    ttl: record.ttl || 3600
  };

  // Technitium uses specific keys based on the record type
  switch (record.type) {
    case 'A':
    case 'AAAA':
      params.ipAddress = record.content;
      break;
    case 'CNAME':
    case 'ANAME':
      params.cname = record.content;
      break;
    case 'TXT':
      params.text = record.content;
      break;
    case 'MX':
      params.exchange = record.content;
      params.preference = record.priority || 10;
      break;
  }
  return params;
}

function convertToStandardFormat(techRecord) {
  return {
    id: `${techRecord.name}-${techRecord.type}-${techRecord.rData?.ipAddress || techRecord.rData?.cname || 'data'}`,
    type: techRecord.type,
    name: techRecord.name,
    content: techRecord.rData?.ipAddress || techRecord.rData?.cname || techRecord.rData?.text || techRecord.rData,
    ttl: techRecord.ttl,
    _original: techRecord
  };
}

module.exports = { convertToTechnitiumFormat, convertToStandardFormat };