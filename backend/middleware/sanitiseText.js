/**
 * @file        sanitiseText.js
 * @description Sanitise text input to prevent XSS and other attacks
 * @author      Chris Staples
 * @license     GPL3
 */

function sanitiseText(text, maxLength = 255) {
    if (typeof text !== 'string') {
        return '';
    }

    // Remove HTML tags and entities
    let sanitised = text
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/&[^;]+;/g, '') // Remove HTML entities
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
        .trim(); // Trim whitespace


    // Trim to max length
    if (maxLength && sanitised.length > maxLength) {
        sanitised = sanitised.substring(0, maxLength).trim();
    }

    return sanitised;
}

module.exports = { sanitiseText };