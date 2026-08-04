const { Schema, model } = require('mongoose');

/**
 * Lưu thông tin invite riêng của mỗi người dùng trên mỗi server.
 *
 * rewardProgress  — số mốc đã được thưởng (mỗi mốc = 5 activeCount).
 *                   Không bao giờ giảm, dùng để tránh thưởng trùng.
 * activeCount     — số người mời hiện còn ở lại server (tăng khi join, giảm khi leave).
 * joinedCount     — tổng số người từng join qua invite này (chỉ tăng, không giảm).
 * uses            — số lần Discord ghi nhận invite được dùng (sync từ Discord API).
 */
const userInviteSchema = new Schema({
  guildId:          { type: String,   required: true },
  userId:           { type: String,   required: true },
  inviteCode:       { type: String,   default: '' },
  inviteURL:        { type: String,   default: '' },
  uses:             { type: Number,   default: 0 },
  joinedCount:      { type: Number,   default: 0 },
  activeCount:      { type: Number,   default: 0 },
  rewardProgress:   { type: Number,   default: 0 },    // milestones rewarded so far (×5 each)
  /**
   * newActiveCount   — số thành viên đang còn trong server VÀ chưa được tính vào
   *                    bất kỳ mốc nào. Reset về 0 sau mỗi 3 người đạt mốc.
   * countedMemberIds — danh sách userId đã được tính vào mốc. Dùng để ngăn
   *                    người cũ vào lại server được tính lần 2.
   */
  newActiveCount:   { type: Number,   default: 0 },
  countedMemberIds: { type: [String], default: [] },
}, { timestamps: true });

userInviteSchema.index({ guildId: 1, userId: 1 }, { unique: true });
userInviteSchema.index({ guildId: 1, inviteCode: 1 }, { sparse: true });

module.exports = model('UserInvite', userInviteSchema);
