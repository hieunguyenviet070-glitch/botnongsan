const { Schema, model } = require('mongoose');

/**
 * Lưu thông tin Creator (Nhà quảng bá) — mỗi Creator có 1 invite riêng.
 *
 * joinCount  — tổng số người vào server qua link này (reset được bằng /creator-reset).
 */
const creatorSchema = new Schema({
  guildId:    { type: String, required: true },
  userId:     { type: String, required: true },
  inviteCode: { type: String, default: '' },
  inviteURL:  { type: String, default: '' },
  joinCount:  { type: Number, default: 0 },
}, { timestamps: true });

creatorSchema.index({ guildId: 1, userId: 1 }, { unique: true });
creatorSchema.index({ guildId: 1, inviteCode: 1 }, { sparse: true });

module.exports = model('Creator', creatorSchema);
