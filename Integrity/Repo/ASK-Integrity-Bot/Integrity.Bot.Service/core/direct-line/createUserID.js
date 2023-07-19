const { promisify } = require('util');
const { randomBytes } = require('crypto');

const randomBytesAsync = promisify(randomBytes);

/**
 * Creates a random user id
 * @returns
 */
const createUserID = async function() {
    const buffer = await randomBytesAsync(16);

    return `dl_${ buffer.toString('hex') }`;
};

module.exports = {
    createUserID
};
