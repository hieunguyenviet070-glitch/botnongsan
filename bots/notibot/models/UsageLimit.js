const { Schema, model } = require('mongoose');

const usageLimitSchema = new Schema({
  guildId:              { type: String, required: true },
  userId:               { type: String, required: true },
  remainingUses:        { type: Number, default: 50 },
  monthlyLimit:         { type: Number, default: 50 },
  lastResetMonth:       { type: String, default: '' },   // "YYYY-MM"
  pendingInviteRewards: { type: Number, default: 0 },    // cumulative invite count (mod 5 determines reward)
  totalInvites:         { type: Number, default: 0 },    // lifetime credited invites
}, { timestamps: true });

usageLimitSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = model('UsageLimit', usageLimitSchema);
