/**
 * PII Detector Service
 * 
 * Detects personally identifiable information in memory text:
 * - Email addresses
 * - Phone numbers
 * - Physical addresses
 * - Social Security Numbers
 * - Credit card numbers
 * - Names (when explicitly labeled)
 * - Dates of birth
 */

import { PIIType } from '../../types';

// Regex patterns for PII detection
const PII_PATTERNS: { type: PIIType; pattern: RegExp; description: string }[] = [
  {
    type: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
    description: 'Email address',
  },
  {
    type: 'phone',
    pattern: /(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    description: 'US phone number',
  },
  {
    type: 'phone',
    pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    description: 'Phone number (generic)',
  },
  {
    type: 'ssn',
    pattern: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
    description: 'Social Security Number',
  },
  {
    type: 'credit_card',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    description: 'Credit card number',
  },
  {
    type: 'credit_card',
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    description: 'Credit card number (formatted)',
  },
  {
    type: 'dob',
    pattern: /\b(?:born|birthday|dob|date of birth)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/gi,
    description: 'Date of birth',
  },
  {
    type: 'address',
    pattern: /\b\d{1,5}\s+(?:[A-Za-z]+\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl)\b/gi,
    description: 'Street address',
  },
];

// Keywords that indicate name information
const NAME_INDICATORS = [
  /\bmy name is\b/i,
  /\bi am\s+[A-Z][a-z]+\b/i,
  /\bcall me\s+[A-Z][a-z]+\b/i,
  /\buser(?:'s)?\s+name\s+is\b/i,
];

class PIIDetector {
  /**
   * Detect all PII types in text
   */
  detect(text: string): PIIType[] {
    const detectedTypes = new Set<PIIType>();

    // Check regex patterns
    for (const { type, pattern } of PII_PATTERNS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        detectedTypes.add(type);
      }
    }

    // Check for name indicators
    for (const indicator of NAME_INDICATORS) {
      if (indicator.test(text)) {
        detectedTypes.add('name');
        break;
      }
    }

    return Array.from(detectedTypes);
  }

  /**
   * Check if text contains any PII
   */
  containsPII(text: string): boolean {
    return this.detect(text).length > 0;
  }

  /**
   * Check if text contains sensitive PII (SSN, credit card)
   */
  containsSensitivePII(text: string): boolean {
    const detected = this.detect(text);
    return detected.some(type => type === 'ssn' || type === 'credit_card');
  }

  /**
   * Mask PII in text for logging/display
   */
  maskPII(text: string): string {
    let masked = text;

    for (const { pattern, type } of PII_PATTERNS) {
      pattern.lastIndex = 0;
      masked = masked.replace(pattern, `[${type.toUpperCase()}_REDACTED]`);
    }

    return masked;
  }

  /**
   * Get detailed PII detection results
   */
  detectDetailed(text: string): {
    type: PIIType;
    value: string;
    position: { start: number; end: number };
  }[] {
    const results: {
      type: PIIType;
      value: string;
      position: { start: number; end: number };
    }[] = [];

    for (const { type, pattern } of PII_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        results.push({
          type,
          value: match[0],
          position: {
            start: match.index,
            end: match.index + match[0].length,
          },
        });
      }
    }

    return results;
  }

  /**
   * Get PII risk level for a memory
   */
  getRiskLevel(piiTypes: PIIType[]): 'none' | 'low' | 'medium' | 'high' | 'critical' {
    if (piiTypes.length === 0) return 'none';
    
    if (piiTypes.includes('ssn') || piiTypes.includes('credit_card')) {
      return 'critical';
    }
    
    if (piiTypes.includes('address') || piiTypes.includes('dob')) {
      return 'high';
    }
    
    if (piiTypes.includes('phone') || piiTypes.includes('email')) {
      return 'medium';
    }
    
    if (piiTypes.includes('name')) {
      return 'low';
    }
    
    return 'low';
  }
}

export const piiDetector = new PIIDetector();
export default piiDetector;















