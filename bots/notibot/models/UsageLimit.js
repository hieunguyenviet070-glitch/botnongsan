const { Schema, model } = require('mongoose');

/**
 * Theo dõi giới hạn lượt sử dụng "Tùy chỉnh thông báo" mỗi tháng.
 *
 * uses                  — lượt còn lại trong tháng (mặc định 100)
 * lastReset             — thời điểm reset gần nhất (dùng để phát hiện tháng mới)
 * inviteMilestonesAwarded — số mốc 3-người invite đã được thưởng (mỗi mốc = +300 lượt)
 */
const usageLimitSchema = new Schema({
  guildId:                { type: String, required: true },
  userId:                 { type: String, required: true },
  uses:                   { type: Number, default: 100 },
  lastReset:              { type: Date,   default: Date.now },
  inviteMilestonesAwarded: { type: Number, default: 0 },
}, { timestamps: true });

usageLimitSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = model('UsageLimit', usageLimitSchema);
