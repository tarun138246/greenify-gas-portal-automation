// crypto-util.js
// AES-256-CBC decryption for the password field.
// Client is expected to encrypt with the same ENCRYPTION_KEY and send the
// payload as "<ivHex>:<cipherTextHex>".
const crypto = require('crypto');

function decryptPassword(encryptedPayload) {
    const key = process.env.ENCRYPTION_KEY;
    if (!key || key.length !== 64) {
        throw new Error('ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes) in the environment');
    }

    const [ivHex, cipherTextHex] = String(encryptedPayload).split(':');
    if (!ivHex || !cipherTextHex) {
        throw new Error('Encrypted password must be in "<ivHex>:<cipherTextHex>" format');
    }

    const keyBuffer = Buffer.from(key, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const cipherText = Buffer.from(cipherTextHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);

    return decrypted.toString('utf8');
}

module.exports = { decryptPassword };
