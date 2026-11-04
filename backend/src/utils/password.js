import argon2 from 'argon2';

// Registration calls this before saving a player's password.
// The returned hash—not the original password—goes into passwordHash.
export async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
  });
}

// Login calls this with the submitted password and the saved hash.
// It returns true only when they match.
export async function verifyPassword(passwordHash, password) {
  return argon2.verify(passwordHash, password);
}
