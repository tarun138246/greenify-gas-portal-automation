// encrypt-password.js
// Helper for callers: encrypts a plaintext password with ENCRYPTION_KEY so it
// can be sent to POST /run-automation. Usage:
//   node encrypt-password.js "myPlainTextPassword"
require('dotenv').config({ quiet: true });
const crypto = require('crypto');

const plainPassword = process.argv[2];
if (!plainPassword) {
    console.error('Usage: node encrypt-password.js "<plainTextPassword>"');
    process.exit(1);
}

const key = process.env.ENCRYPTION_KEY;
if (!key || key.length !== 64) {
    console.error('ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes) in .env');
    process.exit(1);
}

const keyBuffer = Buffer.from(key, 'hex');
const iv = crypto.randomBytes(16);

const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
const encrypted = Buffer.concat([cipher.update(plainPassword, 'utf8'), cipher.final()]);

console.log(`${iv.toString('hex')}:${encrypted.toString('hex')}`);
