/**
 * src/utils/password.js
 * Temporary-password generation. Uses crypto.randomInt (unbiased, CSPRNG).
 * The alphabet leaves out look-alike characters (0/O, 1/l/I) because these
 * passwords are read from a screen or a printed sheet and typed by hand.
 */

import { randomInt } from "node:crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALL = UPPER + LOWER + DIGITS;

export const TEMP_PASSWORD_LENGTH = 12;

const pick = (chars) => chars[randomInt(chars.length)];

/**
 * @returns {string} 12 characters with at least one upper-case letter, one
 *   lower-case letter and one digit (about 66 bits of entropy).
 */
export function generateTemporaryPassword(length = TEMP_PASSWORD_LENGTH) {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(ALL));
  // Fisher-Yates shuffle so the guaranteed characters are not always first
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
