const axios = require('axios');
const DNSProvider = require('../base');
const logger = require('../../utils/logger');
const { convertToTechnitiumFormat, convertToStandardFormat } = require('./converter');
const { validateRecord } = require('./validator');

class TechnitiumProvider extends DNSProvider {
  constructor(config) {
    super(config);
    this.apiUrl = config.technitiumUrl.replace(/\/$/, '');
    this.token = config.technitiumToken;
    this.zone = config.technitiumZone;
    
    this.client = axios.create({
      baseURL: this.apiUrl,
      timeout: config.apiTimeout || 10000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  }

  async init() {
    try {
      await this.refreshRecordCache();
      logger.info(`Technitium provider initialized for zone: ${this.zone}`);
      return true;
    } catch (error) {
      throw new Error(`Technitium initialization failed: ${error.message}`);
    }
  }

  /**
   * Refresh the local cache of DNS records
   */
  async refreshRecordCache() {
    const params = new URLSearchParams({
      token: this.token,
      domain: this.zone,
      zone: this.zone,
      listAll: 'true'
    });

    const response = await this.client.get(`/api/zones/records/get?${params.toString()}`);
    if (response.data.status !== 'ok') throw new Error(`Technitium API Error: ${response.data.status}`);

    const records = response.data.response.records || [];
    this.recordCache.records = records.map(convertToStandardFormat);
    this.recordCache.lastUpdated = Date.now();
    return this.recordCache.records;
  }

  async listRecords(params = {}) {
    const records = await this.getRecordsFromCache();
    return records.filter(r => {
      if (params.type && r.type !== params.type) return false;
      if (params.name && r.name !== params.name) return false;
      return true;
    });
  }

  async createRecord(record) {
    validateRecord(record);
    const techData = convertToTechnitiumFormat(record);
    const params = new URLSearchParams({ ...techData, token: this.token, zone: this.zone });

    const response = await this.client.post('/api/zones/records/add', params.toString());
    if (response.data.status !== 'ok') throw new Error(`Create failed: ${response.data.status}`);

    await this.refreshRecordCache();
    return record;
  }

  async updateRecord(id, record) {
    // Technitium requires delete + create for updates
    await this.deleteRecord(id);
    return await this.createRecord(record);
  }

  async deleteRecord(id) {
    const record = this.recordCache.records.find(r => r.id === id);
    if (!record) return false;

    const techData = convertToTechnitiumFormat(record);
    const params = new URLSearchParams({ 
      ...techData, 
      token: this.token, 
      zone: this.zone,
      domain: record.name 
    });

    const response = await this.client.post('/api/zones/records/delete', params.toString());
    if (response.data.status === 'ok') {
      this.recordCache.records = this.recordCache.records.filter(r => r.id !== id);
      return true;
    }
    return false;
  }

  /**
   * MISSING METHOD: Batch process records
   */
  async batchEnsureRecords(recordConfigs) {
    if (!recordConfigs?.length) return [];
    
    await this.getRecordsFromCache();
    const results = [];

    for (const config of recordConfigs) {
      try {
        const existing = this.recordCache.records.find(r => 
          r.name === config.name && r.type === config.type
        );

        if (!existing) {
          logger.info(`✨ Creating Technitium ${config.type} record for ${config.name}`);
          results.push(await this.createRecord(config));
        } else if (this.recordNeedsUpdate(existing, config)) {
          logger.info(`🔄 Updating Technitium ${config.type} record for ${config.name}`);
          results.push(await this.updateRecord(existing.id, config));
        }
      } catch (error) {
        logger.error(`Failed to process record ${config.name}: ${error.message}`);
      }
    }
    return results;
  }

  /**
   * Helper to check if record changed
   */
  recordNeedsUpdate(existing, newRecord) {
    const contentDiff = existing.content !== newRecord.content;
    const ttlDiff = newRecord.ttl && existing.ttl !== newRecord.ttl;
    
    if (contentDiff) logger.debug(`Record ${existing.name} content: ${existing.content} -> ${newRecord.content}`);
    if (ttlDiff) logger.debug(`Record ${existing.name} TTL: ${existing.ttl} -> ${newRecord.ttl}`);

    return contentDiff || ttlDiff;
  }
}

module.exports = TechnitiumProvider;