import { hashPassword } from "../lib/security.js";

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error("Usage: npm run hash-admin-password -- <password with at least 12 characters>");
  process.exit(2);
}
console.log(hashPassword(password));
