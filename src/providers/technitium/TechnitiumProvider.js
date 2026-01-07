// src/providers/technitium/TechnitiumProvider.js

const axios = require('axios');
const logger = require('../../utils/logger');

class TechnitiumProvider {
  constructor() {
    this.name = 'Technitium';
    this.apiUrl = process.env.TECHNITIUM_URL;
    this.token = process.env.TECHNITIUM_TOKEN;
    this.zone = process.env.TECHNITIUM_ZONE;
    
    if (!this.apiUrl || !this.token || !this.zone) {
      throw new Error('Technitium provider requires TECHNITIUM_URL, TECHNITIUM_TOKEN, and TECHNITIUM_ZONE');
    }
    
    // Remove trailing slash from URL
    this.apiUrl = this.apiUrl.replace(/\/$/, '');
    
    // Initialize axios instance
    this.client = axios.create({
      baseURL: this.apiUrl,
      timeout: parseInt(process.env.API_TIMEOUT || '60000'),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    logger.info(`Technitium provider initialized for zone: ${this.zone}`);
  }

  /**
   * Fetch all DNS records for the zone
   */
  async fetchRecords() {
    try {
      const params = new URLSearchParams({
        token: this.token,
        domain: this.zone,
        zone: this.zone
      });

      const response = await this.client.get(`/api/zones/records/get?${params.toString()}`);
      
      if (response.data.status !== 'ok') {
        throw new Error(`Technitium API error: ${response.data.status}`);
      }

      const records = response.data.response.records || [];
      
      // Transform Technitium records to standard format
      const transformedRecords = records.map(record => ({
        name: this.getRecordName(record.name),
        type: record.type,
        content: this.getRecordContent(record),
        ttl: record.ttl || 300,
        // Store original record for reference
        _original: record
      }));

      logger.debug(`Fetched ${transformedRecords.length} records from Technitium`);
      return transformedRecords;
      
    } catch (error) {
      logger.error(`Error fetching Technitium records: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a new DNS record
   */
  async createRecord(hostname, type, content, ttl = 300, additionalOptions = {}) {
    try {
      const params = new URLSearchParams({
        token: this.token,
        domain: hostname,
        zone: this.zone,
        type: type,
        ttl: ttl.toString(),
        overwrite: 'false'
      });

      // Add type-specific parameters
      switch (type.toUpperCase()) {
        case 'A':
        case 'AAAA':
          params.append('ipAddress', content);
          if (additionalOptions.ptr) {
            params.append('ptr', 'true');
          }
          break;
          
        case 'CNAME':
          params.append('cname', content);
          break;
          
        case 'MX':
          params.append('mailExchange', content);
          params.append('preference', additionalOptions.priority || '10');
          break;
          
        case 'TXT':
          params.append('text', content);
          break;
          
        case 'SRV':
          params.append('target', content);
          params.append('priority', additionalOptions.priority || '10');
          params.append('weight', additionalOptions.weight || '10');
          params.append('port', additionalOptions.port || '80');
          break;
          
        case 'CAA':
          params.append('value', content);
          params.append('flags', additionalOptions.flags || '0');
          params.append('tag', additionalOptions.tag || 'issue');
          break;
          
        case 'NS':
          params.append('nameServer', content);
          if (additionalOptions.glue) {
            params.append('glue', additionalOptions.glue);
          }
          break;
          
        case 'PTR':
          params.append('ptrName', content);
          break;
          
        default:
          // For unknown types, try to use content as-is
          params.append('rdata', content);
      }

      const response = await this.client.post('/api/zones/records/add', params.toString());
      
      if (response.data.status !== 'ok') {
        throw new Error(`Technitium API error: ${response.data.status}`);
      }

      logger.info(`Created ${type} record: ${hostname} -> ${content}`);
      return true;
      
    } catch (error) {
      if (error.response?.data?.status === 'error' && 
          error.response?.data?.errorMessage?.includes('already exists')) {
        logger.debug(`Record already exists: ${hostname} (${type})`);
        return false;
      }
      logger.error(`Error creating Technitium record: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update an existing DNS record
   */
  async updateRecord(hostname, type, oldContent, newContent, ttl = 300, additionalOptions = {}) {
    try {
      // Technitium doesn't have a direct update - we need to delete and recreate
      await this.deleteRecord(hostname, type, oldContent);
      await this.createRecord(hostname, type, newContent, ttl, additionalOptions);
      
      logger.info(`Updated ${type} record: ${hostname} (${oldContent} -> ${newContent})`);
      return true;
      
    } catch (error) {
      logger.error(`Error updating Technitium record: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a DNS record
   */
  async deleteRecord(hostname, type, content) {
    try {
      const params = new URLSearchParams({
        token: this.token,
        domain: hostname,
        zone: this.zone,
        type: type
      });

      // Add type-specific parameters for deletion
      switch (type.toUpperCase()) {
        case 'A':
        case 'AAAA':
          params.append('ipAddress', content);
          break;
          
        case 'CNAME':
          params.append('cname', content);
          break;
          
        case 'MX':
          params.append('mailExchange', content);
          break;
          
        case 'TXT':
          params.append('text', content);
          break;
          
        case 'NS':
          params.append('nameServer', content);
          break;
          
        case 'PTR':
          params.append('ptrName', content);
          break;
          
        default:
          // For SRV, CAA and others, we may need more specific matching
          // This is a simplified approach
          params.append('rdata', content);
      }

      const response = await this.client.post('/api/zones/records/delete', params.toString());
      
      if (response.data.status !== 'ok') {
        throw new Error(`Technitium API error: ${response.data.status}`);
      }

      logger.info(`Deleted ${type} record: ${hostname} -> ${content}`);
      return true;
      
    } catch (error) {
      if (error.response?.data?.status === 'error' && 
          error.response?.data?.errorMessage?.includes('not found')) {
        logger.debug(`Record not found for deletion: ${hostname} (${type})`);
        return false;
      }
      logger.error(`Error deleting Technitium record: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the record name (hostname) from Technitium record
   */
  getRecordName(name) {
    // Remove the zone suffix if present
    if (name === this.zone || name === '@') {
      return this.zone;
    }
    if (name.endsWith(`.${this.zone}`)) {
      return name;
    }
    // If it's a subdomain without the zone, append it
    if (!name.includes('.')) {
      return `${name}.${this.zone}`;
    }
    return name;
  }

  /**
   * Extract content from Technitium record based on type
   */
  getRecordContent(record) {
    switch (record.type.toUpperCase()) {
      case 'A':
      case 'AAAA':
        return record.rData?.ipAddress || record.rData;
        
      case 'CNAME':
        return record.rData?.cname || record.rData;
        
      case 'MX':
        return record.rData?.mailExchange || record.rData?.exchange || record.rData;
        
      case 'TXT':
        return record.rData?.text || record.rData;
        
      case 'NS':
        return record.rData?.nameServer || record.rData;
        
      case 'PTR':
        return record.rData?.ptrName || record.rData;
        
      case 'SRV':
        return record.rData?.target || record.rData;
        
      case 'CAA':
        return record.rData?.value || record.rData;
        
      default:
        // For other types, return the rData as-is
        return typeof record.rData === 'object' ? 
          JSON.stringify(record.rData) : record.rData;
    }
  }

  /**
   * Validate DNS record before creation
   */
  validateRecord(hostname, type, content, additionalOptions = {}) {
    // Basic validation
    if (!hostname || !type || !content) {
      throw new Error('Hostname, type, and content are required');
    }

    // Type-specific validation
    switch (type.toUpperCase()) {
      case 'A':
        if (!this.isValidIPv4(content)) {
          throw new Error(`Invalid IPv4 address: ${content}`);
        }
        break;
        
      case 'AAAA':
        if (!this.isValidIPv6(content)) {
          throw new Error(`Invalid IPv6 address: ${content}`);
        }
        break;
        
      case 'CNAME':
        if (hostname === this.zone) {
          throw new Error('CNAME records cannot be created at zone apex. Use A or ANAME instead.');
        }
        break;
        
      case 'MX':
        if (!additionalOptions.priority) {
          additionalOptions.priority = 10;
        }
        break;
        
      case 'SRV':
        if (!additionalOptions.priority) additionalOptions.priority = 10;
        if (!additionalOptions.weight) additionalOptions.weight = 10;
        if (!additionalOptions.port) additionalOptions.port = 80;
        break;
    }

    return true;
  }

  /**
   * Validate IPv4 address
   */
  isValidIPv4(ip) {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Regex.test(ip)) return false;
    
    const parts = ip.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  /**
   * Validate IPv6 address
   */
  isValidIPv6(ip) {
    const ipv6Regex = /^([\da-fA-F]{1,4}:){7}[\da-fA-F]{1,4}$|^::$|^([\da-fA-F]{1,4}:){1,6}:$|^:((:[\da-fA-F]{1,4}){1,6})$/;
    return ipv6Regex.test(ip);
  }

  /**
   * Get minimum TTL for this provider
   */
  getMinimumTTL() {
    return 1; // Technitium supports very low TTLs
  }

  /**
   * Check if record type is supported
   */
  supportsRecordType(type) {
    const supportedTypes = [
      'A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'PTR', 
      'SRV', 'CAA', 'ANAME', 'DNAME', 'SSHFP', 'TLSA', 
      'SVCB', 'HTTPS', 'URI', 'DS'
    ];
    return supportedTypes.includes(type.toUpperCase());
  }
}

module.exports = TechnitiumProvider;