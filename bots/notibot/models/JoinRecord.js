const { Schema, model } = require('mongoose');

// Tracks who invited each member, so we can decrement the inviter's count on leave.
const joinRecordSchema = new Schema({
  guildId:    { type: String, required: true },
  userId:     { type: String, required: true },   // the member who joined
  inviterId:  { type: String, required: true },   // the member who owns the invite
  inviteCode: { type: String, required: true },
}, { timestamps: true });

joinRecordSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = model('JoinRecord', joinRecordSchema);
