/**
 * Listener tách riêng: xử lý toàn bộ lệnh /usage
 * Tất cả phản hồi đều là Embed Ephemeral.
 * Chỉ Administrator mới được sử dụng.
 */

const UsageLimit = require('../models/UsageLimit.js');
const BypassRole = require('../models/BypassRole.js');
const { getUserLimit, ROLE_LIMITS, DEFAULT_LIMIT } = require('../utils/usageUtils.js');
const { revokeNotificationRoles } = require('../utils/roleRevoke.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ephemeral(embed) {
  return { embeds: [embed], ephemeral: true };
}

function errorEmbed(desc) {
  return { color: 0xe74c3c, description: desc };
}

function successEmbed(desc) {
  return { color: 0x2ecc71, description: desc };
}

/** Lấy hoặc tạo UsageLimit doc, đồng thời đồng bộ monthlyLimit và reset tháng. */
async function getOrCreateDoc(guildId, userId, userLimit) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const effectiveLimit = userLimit === Infinity ? DEFAULT_LIMIT : userLimit; // không lưu Infinity vào DB
  let doc = await UsageLimit.findOneAndUpdate(
    { guildId, userId },
    { $setOnInsert: { remainingUses: effectiveLimit, monthlyLimit: effectiveLimit, lastResetMonth: currentMonth, pendingInviteRewards: 0, totalInvites: 0 } },
    { upsert: true, returnDocument: 'after' }
  );
  if (doc.monthlyLimit !== effectiveLimit) {
    doc = await UsageLimit.findOneAndUpdate({ guildId, userId }, { $set: { monthlyLimit: effectiveLimit } }, { returnDocument: 'after' });
  }
  if (doc.lastResetMonth !== currentMonth) {
    doc = await UsageLimit.findOneAndUpdate({ guildId, userId }, { $set: { remainingUses: doc.monthlyLimit, lastResetMonth: currentMonth } }, { returnDocument: 'after' });
  }
  return doc;
}

/** Tên Role hoặc "Role không tìm thấy" */
function roleName(guild, roleId) {
  const r = guild.roles.cache.get(roleId);
  return r ? `<@&${roleId}>` : `\`${roleId}\``;
}

// ─── Subcommand handlers ──────────────────────────────────────────────────────

async function handleCheck(interaction, guild) {
  const targetUser = interaction.options.getUser('user', true);
  let targetMember;
  try {
    targetMember = await guild.members.fetch(targetUser.id);
  } catch (_) {
    return interaction.reply(ephemeral(errorEmbed(`❌ Không tìm thấy thành viên <@${targetUser.id}> trên server này.`)));
  }

  const userLimit = await getUserLimit(targetMember);
  const isUnlimited = userLimit === Infinity;

  // Xác định role đang áp dụng
  let appliedRole = 'Mặc định (50 lượt)';
  try {
    const bypassRoles = await BypassRole.find({ guildId: guild.id }).lean();
    for (const br of bypassRoles) {
      if (targetMember.roles.cache.has(br.roleId)) {
        appliedRole = `${roleName(guild, br.roleId)} (Không giới hạn)`;
        break;
      }
    }
    if (appliedRole === 'Mặc định (50 lượt)') {
      for (const [roleId, limit] of Object.entries(ROLE_LIMITS)) {
        if (targetMember.roles.cache.has(roleId)) {
          appliedRole = `${roleName(guild, roleId)} (${limit} lượt/tháng)`;
          break;
        }
      }
    }
  } catch (_) { /* DB offline */ }

  if (isUnlimited) {
    const embed = {
      color: 0xf1c40f,
      title: '📊 Thông tin lượt sử dụng',
      fields: [
        { name: '👤 Người dùng', value: `<@${targetUser.id}>`, inline: true },
        { name: '🏷️ Role áp dụng', value: appliedRole, inline: true },
        { name: '♾️ Giới hạn', value: 'Không giới hạn', inline: false },
      ],
      footer: { text: 'Role không giới hạn — không bị trừ lượt.' }
    };
    return interaction.reply(ephemeral(embed));
  }

  let doc = null;
  try {
    doc = await getOrCreateDoc(guild.id, targetUser.id, userLimit);
  } catch (err) {
    return interaction.reply(ephemeral(errorEmbed(`❌ Lỗi MongoDB: ${err.message}`)));
  }

  const used = doc.monthlyLimit - doc.remainingUses;
  const embed = {
    color: 0x3498db,
    title: '📊 Thông tin lượt sử dụng',
    fields: [
      { name: '👤 Người dùng', value: `<@${targetUser.id}>`, inline: true },
      { name: '🏷️ Role áp dụng', value: appliedRole, inline: true },
      { name: '📋 Giới hạn tháng này', value: `${doc.monthlyLimit} lượt`, inline: true },
      { name: '✅ Lượt còn lại', value: `${doc.remainingUses}`, inline: true },
      { name: '📉 Đã sử dụng', value: `${Math.max(0, used)}`, inline: true },
      { name: '🎁 Lượt được cộng thêm (invite)', value: `+${Math.floor(doc.totalInvites / 5) * 50}`, inline: true },
      { name: '👥 Số người đã mời', value: `${doc.totalInvites} người`, inline: true },
    ],
    footer: { text: `Lượt reset vào đầu tháng sau.` }
  };
  return interaction.reply(ephemeral(embed));
}

async function handleAdd(interaction, guild) {
  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  try {
    await UsageLimit.findOneAndUpdate(
      { guildId: guild.id, userId: targetUser.id },
      {
        $inc: { remainingUses: amount },
        $setOnInsert: { monthlyLimit: DEFAULT_LIMIT, lastResetMonth: new Date().toISOString().slice(0, 7), pendingInviteRewards: 0, totalInvites: 0 }
      },
      { upsert: true, returnDocument: 'after' }
    );
    return interaction.reply(ephemeral(successEmbed(`✅ Đã cộng **${amount} lượt** sử dụng cho <@${targetUser.id}>.`)));
  } catch (err) {
    return interaction.reply(ephemeral(errorEmbed(`❌ Lỗi MongoDB: ${err.message}`)));
  }
}

async function handleRemove(interaction, guild) {
  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  try {
    const doc = await UsageLimit.findOne({ guildId: guild.id, userId: targetUser.id });
    const current = doc ? doc.remainingUses : 0;
    const newVal = Math.max(0, current - amount);
    await UsageLimit.findOneAndUpdate(
      { guildId: guild.id, userId: targetUser.id },
      {
        $set: { remainingUses: newVal },
        $setOnInsert: { monthlyLimit: DEFAULT_LIMIT, lastResetMonth: new Date().toISOString().slice(0, 7), pendingInviteRewards: 0, totalInvites: 0 }
      },
      { upsert: true, returnDocument: 'after' }
    );

    // Gỡ role nếu hết lượt
    if (newVal <= 0) {
      try {
        const targetMember = await guild.members.fetch(targetUser.id);
        const revokedCount = await revokeNotificationRoles(targetMember);
        const revokeNote = revokedCount > 0
          ? `\n📌 Đã tự động thu hồi **${revokedCount} role** thông báo và gửi DM cho người dùng.`
          : '\n📌 Người dùng không có role thông báo nào để gỡ.';
        return interaction.reply(ephemeral(successEmbed(
          `✅ Đã trừ **${amount} lượt** sử dụng của <@${targetUser.id}>. (Còn lại: 0)${revokeNote}`
        )));
      } catch (_) {
        return interaction.reply(ephemeral(successEmbed(
          `✅ Đã trừ **${amount} lượt** sử dụng của <@${targetUser.id}>. (Còn lại: 0)\n⚠️ Không thể gỡ role: không tìm thấy thành viên trên server.`
        )));
      }
    }

    return interaction.reply(ephemeral(successEmbed(`✅ Đã trừ **${amount} lượt** sử dụng của <@${targetUser.id}>. (Còn lại: ${newVal})`)));
  } catch (err) {
    return interaction.reply(ephemeral(errorEmbed(`❌ Lỗi MongoDB: ${err.message}`)));
  }
}

async function handleSet(interaction, guild) {
  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  try {
    await UsageLimit.findOneAndUpdate(
      { guildId: guild.id, userId: targetUser.id },
      {
        $set: { remainingUses: amount },
        $setOnInsert: { monthlyLimit: DEFAULT_LIMIT, lastResetMonth: new Date().toISOString().slice(0, 7), pendingInviteRewards: 0, totalInvites: 0 }
      },
      { upsert: true, returnDocument: 'after' }
    );
    return interaction.reply(ephemeral(successEmbed(`✅ Đã đặt số lượt còn lại của <@${targetUser.id}> thành **${amount}**.`)));
  } catch (err) {
    return interaction.reply(ephemeral(errorEmbed(`❌ Lỗi MongoDB: ${err.message}`)));
  }
}

async function handleReset(interaction, guild) {
  const targetUser = interaction.options.getUser('user', true);
  try {
    // Lấy member để tính đúng monthly limit của họ
    let targetMember;
    try {
      targetMember = await guild.members.fetch(targetUser.id);
    } catch (_) {
      return interaction.reply(ephemeral(errorEmbed(`❌ Không tìm thấy thành viên <@${targetUser.id}> trên server này.`)));
    }

    const userLimit = await getUserLimit(targetMember);
    const effectiveLimit = userLimit === Infinity ? DEFAULT_LIMIT : userLimit;
    const currentMonth = new Date().toISOString().slice(0, 7);

    await UsageLimit.findOneAndUpdate(
      { guildId: guild.id, userId: targetUser.id },
      {
        $set: { remainingUses: effectiveLimit, monthlyLimit: effectiveLimit, lastResetMonth: currentMonth },
        $setOnInsert: { pendingInviteRewards: 0, totalInvites: 0 }
      },
      { upsert: true, returnDocument: 'after' }
    );
    return interaction.reply(ephemeral(successEmbed(`✅ Đã reset lượt sử dụng của <@${targetUser.id}> về **${effectiveLimit} lượt** (giới hạn tháng hiện tại).`)));
  } catch (err) {
    return interaction.reply(ephemeral(errorEmbed(`❌ Lỗi MongoDB: ${err.message}`)));
  }
}

async function handleBypassAdd(interaction, guild) {
  const role = interaction.options.getRole('role', true);
  try {
    await BypassRole.findOneAndUpdate(
      { guildId: guild.id, roleId: role.id },
      { guildId: guild.id, roleId: role.id },
      { upsert: true, returnDocument: 'after' }
    );
    return interaction.reply(ephemeral(successEmbed(`✅ Đã thêm <@&${role.id}> vào danh sách Role không giới hạn.`)));
  } catch (err) {
    return interaction.reply(ephemeral(errorEmbed(`❌ Lỗi MongoDB: ${err.message}`)));
  }
}

async function handleBypassRemove(interaction, guild) {
  const role = interaction.options.getRole('role', true);
  try {
    const result = await BypassRole.deleteOne({ guildId: guild.id, roleId: role.id });
    if (result.deletedCount === 0) {
      return interaction.reply(ephemeral(errorEmbed(`⚠️ <@&${role.id}> không có trong danh sách Role không giới hạn.`)));
    }
    return interaction.reply(ephemeral(successEmbed(`✅ Đã xóa <@&${role.id}> khỏi danh sách Role không giới hạn.`)));
  } catch (err) {
    return interaction.reply(ephemeral(errorEmbed(`❌ Lỗi MongoDB: ${err.message}`)));
  }
}

async function handleBypassList(interaction, guild) {
  try {
    const bypassRoles = await BypassRole.find({ guildId: guild.id }).lean();
    if (bypassRoles.length === 0) {
      return interaction.reply(ephemeral({
        color: 0x95a5a6,
        title: '♾️ Danh sách Role không giới hạn',
        description: 'Chưa có Role nào được cấu hình.',
      }));
    }
    const lines = bypassRoles.map(br => `• <@&${br.roleId}>`).join('\n');
    return interaction.reply(ephemeral({
      color: 0xf1c40f,
      title: '♾️ Danh sách Role không giới hạn',
      description: lines,
    }));
  } catch (err) {
    return interaction.reply(ephemeral(errorEmbed(`❌ Lỗi MongoDB: ${err.message}`)));
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Gọi từ interactionCreate khi interaction.commandName === 'usage'.
 */
async function handleUsageCommand(interaction, guild, member) {
  // Kiểm tra quyền Administrator
  if (!member.permissions.has('ADMINISTRATOR')) {
    return interaction.reply(ephemeral(errorEmbed('❌ Bạn không có quyền sử dụng lệnh này. Yêu cầu quyền **Administrator**.')));
  }

  const subGroup = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (subGroup === 'bypass') {
    if (sub === 'add')    return handleBypassAdd(interaction, guild);
    if (sub === 'remove') return handleBypassRemove(interaction, guild);
    if (sub === 'list')   return handleBypassList(interaction, guild);
  } else {
    if (sub === 'check')  return handleCheck(interaction, guild);
    if (sub === 'add')    return handleAdd(interaction, guild);
    if (sub === 'remove') return handleRemove(interaction, guild);
    if (sub === 'set')    return handleSet(interaction, guild);
    if (sub === 'reset')  return handleReset(interaction, guild);
  }
}

module.exports = { handleUsageCommand };
