const BypassRole = require('../models/BypassRole.js');

/**
 * Hardcoded role → monthly limit mapping.
 * Only roles with a numeric limit go here.
 * Unlimited (bypass) roles are managed in MongoDB via /usage bypass commands.
 */
const ROLE_LIMITS = {
  '1512799562149003275': 100,
  '1514290379787079881': 200,
};
const DEFAULT_LIMIT = 50;

/**
 * Returns the effective monthly usage limit for a GuildMember.
 * - Infinity  → bypass (unlimited); skip all checks and deductions.
 * - Number    → monthly cap; reset at start of each month.
 *
 * Always returns the highest privilege the member holds.
 * Bypass roles from MongoDB always win over numeric limits.
 */
async function getUserLimit(member) {
  // 1. Check MongoDB bypass roles (unlimited)
  try {
    const bypassRoles = await BypassRole.find({ guildId: member.guild.id }).lean();
    for (const br of bypassRoles) {
      if (member.roles.cache.has(br.roleId)) return Infinity;
    }
  } catch (_) {
    // DB offline — fall through to hardcoded limits
  }

  // 2. Check hardcoded numeric limits; take the highest
  let best = DEFAULT_LIMIT;
  for (const [roleId, limit] of Object.entries(ROLE_LIMITS)) {
    if (member.roles.cache.has(roleId) && limit > best) {
      best = limit;
    }
  }
  return best;
}

module.exports = { getUserLimit, ROLE_LIMITS, DEFAULT_LIMIT };
