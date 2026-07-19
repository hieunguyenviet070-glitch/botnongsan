const { Schema, model } = require('mongoose');

const bypassRoleSchema = new Schema({
  guildId: { type: String, required: true },
  roleId:  { type: String, required: true },
}, { timestamps: true });

bypassRoleSchema.index({ guildId: 1, roleId: 1 }, { unique: true });

module.exports = model('BypassRole', bypassRoleSchema);
