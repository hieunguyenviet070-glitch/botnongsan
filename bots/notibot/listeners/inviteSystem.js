/**
 * inviteSystem.js — Hệ thống "Mời bạn bè"
 *
 * Cache format: Map<guildId, Map<inviteCode, uses: number>>
 * Chủ invite được xác định bằng cách tra DB theo inviteCode — KHÔNG dùng invite.inviter.
 *
 * Exports:
 *   init(inviteCache, log, botClient)
 *   handleInviteCreate(invite)
 *   handleInviteDelete(invite)
 *   handleGuildMemberAdd(member)
 *   handleGuildMemberRemove(member)
 *   handleInviteButton(interaction, guild)
 */

'use strict';

const JoinRecord = require('../models/JoinRecord.js');
const UserInvite = require('../models/UserInvite.js');

// ─── Module state ─────────────────────────────────────────────────────────────

/** Map<guildId, Map<code, uses>> — chia sẻ tham chiếu với index.js */
let _cache     = null;
let _log       = null;
let _botClient = null;

/**
 * Phải gọi 1 lần sau khi bot ready và cache đã được populate.
 * inviteCache phải là Map<guildId, Map<code, uses:number>>.
 */
function init(inviteCache, log, botClient) {
  _cache     = inviteCache;
  _log       = log;
  _botClient = botClient;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

/** inviteCreate: thêm code mới vào cache với uses hiện tại */
function handleInviteCreate(invite) {
  const guildId = invite.guild?.id;
  if (!guildId || !_cache) return;
  const gMap = _cache.get(guildId) ?? new Map();
  gMap.set(invite.code, invite.uses ?? 0);
  _cache.set(guildId, gMap);
  _log?.info(`[Invite] Cache +1 invite ${invite.code} (guild: ${guildId})`);
}

/** inviteDelete: xóa code khỏi cache */
function handleInviteDelete(invite) {
  const guildId = invite.guild?.id;
  if (!guildId || !_cache) return;
  const gMap = _cache.get(guildId);
  if (gMap) gMap.delete(invite.code);
  _log?.info(`[Invite] Cache -1 invite ${invite.code} (guild: ${guildId})`);
}

// ─── guildMemberAdd ───────────────────────────────────────────────────────────

/**
 * Khi có người vào server:
 *  1. Fetch toàn bộ invite hiện tại.
 *  2. So sánh với cache cũ → tìm code có uses tăng.
 *  3. Tra UserInvite theo inviteCode để lấy userId của chủ invite.
 *  4. Cập nhật joinedCount, activeCount, thưởng mốc 5 người.
 *  5. Lưu JoinRecord (memberId → inviterId) để xử lý khi rời.
 *  6. Cập nhật cache mới.
 */
async function handleGuildMemberAdd(member) {
  const g = member.guild;
  try {
    // ── 1. Snapshot cache cũ ────────────────────────────────────────────────
    const cachedUses = _cache.get(g.id) ?? new Map(); // Map<code, uses>

    // ── 2. Fetch invite mới nhất ─────────────────────────────────────────────
    let freshInvites;
    try {
      freshInvites = await g.invites.fetch();
    } catch (err) {
      _log.warn(`[Invite] Không thể fetch invite guild ${g.name}: ${err.message}`);
      return;
    }

    // ── 3. Tìm code có uses tăng ─────────────────────────────────────────────
    let usedCode = null;
    freshInvites.forEach(inv => {
      const before = cachedUses.get(inv.code) ?? 0;
      if (inv.uses > before) usedCode = inv.code;
    });

    // ── 4. Cập nhật cache NGAY — trước mọi await khác ────────────────────────
    const newMap = new Map();
    freshInvites.forEach(inv => newMap.set(inv.code, inv.uses));
    _cache.set(g.id, newMap);

    if (!usedCode) {
      _log.warn(`[Invite] Không xác định được invite khi ${member.user.tag} vào server.`);
      return;
    }

    // ── 5. Tra DB để lấy chủ invite (KHÔNG dùng invite.inviter) ─────────────
    const inviteOwner = await UserInvite.findOne({ guildId: g.id, inviteCode: usedCode });
    if (!inviteOwner) {
      // Kiểm tra có phải invite của Creator không
      const Creator = require('../models/Creator.js');
      const creatorDoc = await Creator.findOneAndUpdate(
        { guildId: g.id, inviteCode: usedCode },
        { $inc: { joinCount: 1 } },
        { new: true },
      );
      if (creatorDoc) {
        // Lưu JoinRecord để trừ joinCount khi member rời
        try {
          await JoinRecord.create({
            guildId:    g.id,
            userId:     member.id,
            inviterId:  creatorDoc.userId,
            inviteCode: usedCode,
          });
        } catch (_) { /* duplicate — bỏ qua */ }
        _log.info(`[Creator] ${member.user.tag} vào server qua invite Creator ${usedCode} (creator: ${creatorDoc.userId}) — tổng: ${creatorDoc.joinCount}`);
      } else {
        _log.info(`[Invite] Code ${usedCode} không có trong DB — bỏ qua.`);
      }
      return;
    }
    const inviterId = inviteOwner.userId;

    // ── 6. Lưu JoinRecord để xử lý khi member rời ───────────────────────────
    try {
      await JoinRecord.create({
        guildId:    g.id,
        userId:     member.id,
        inviterId,
        inviteCode: usedCode,
      });
    } catch (_) { /* duplicate — bỏ qua */ }

    // ── 7. Tăng joinedCount + activeCount ────────────────────────────────────
    // Kiểm tra người này đã được tính vào mốc trước chưa
    const alreadyCounted = (inviteOwner.countedMemberIds || []).includes(member.id);
    const incFields = { joinedCount: 1, activeCount: 1 };
    if (!alreadyCounted) incFields.newActiveCount = 1; // chỉ tính nếu chưa từng được tính
    const inviteDoc = await UserInvite.findOneAndUpdate(
      { guildId: g.id, userId: inviterId },
      { $inc: incFields },
      { new: true },
    );

    _log.info(
      `[Invite] ${member.user.tag} vào server qua code ${usedCode}` +
      ` (chủ: ${inviterId}) — active: ${inviteDoc.activeCount}` +
      ` | newActive: ${inviteDoc.newActiveCount}` +
      (alreadyCounted ? ' [đã tính trước]' : ' [mới]'),
    );

    // ── 8. Kiểm tra và cộng thưởng mốc 5 người ──────────────────────────────
    await _checkAndAwardMilestone(g.id, inviterId, inviteDoc);

    // ── 9. Kiểm tra và cộng thưởng mốc 3 người mới cho UsageLimit ───────────
    await _checkUsageLimitMilestone(g.id, inviterId, inviteDoc);

  } catch (err) {
    _log.error('[Invite] Lỗi guildMemberAdd:', err.message);
  }
}

// ─── guildMemberRemove ────────────────────────────────────────────────────────

/**
 * Khi có người rời server:
 *  1. Tra JoinRecord để lấy inviterId.
 *  2. Giảm activeCount của chủ invite (min 0).
 *  (rewardProgress không giảm — mốc đã thưởng không thu hồi)
 */
async function handleGuildMemberRemove(member) {
  const g = member.guild;
  try {
    const joinRecord = await JoinRecord.findOneAndDelete({ guildId: g.id, userId: member.id });
    if (!joinRecord?.inviterId) return;

    // Kiểm tra người rời đã được tính vào mốc chưa (để giảm đúng counter)
    const inviteOwnerDoc = await UserInvite.findOne({ guildId: g.id, userId: joinRecord.inviterId });
    const wasCounted = (inviteOwnerDoc?.countedMemberIds || []).includes(member.id);
    const decFields = { activeCount: -1 };
    if (!wasCounted) decFields.newActiveCount = -1; // chỉ giảm nếu chưa được tính mốc

    const updated = await UserInvite.findOneAndUpdate(
      { guildId: g.id, userId: joinRecord.inviterId },
      { $inc: decFields },
      { new: true },
    );

    // Đảm bảo không âm
    const fixes = {};
    if (updated?.activeCount < 0)    fixes.activeCount    = 0;
    if (updated?.newActiveCount < 0) fixes.newActiveCount = 0;
    if (Object.keys(fixes).length > 0) {
      await UserInvite.updateOne({ guildId: g.id, userId: joinRecord.inviterId }, { $set: fixes });
    }

    const finalCount = updated ? Math.max(0, updated.activeCount) : 0;
    _log.info(
      `[Invite] ${member.user.tag} rời server — ` +
      `active của ${joinRecord.inviterId}: ${finalCount}` +
      (wasCounted ? ' [đã tính trước, không trừ newActive]' : ' [mới, trừ newActive]'),
    );

    // ── Trừ joinCount nếu inviterId là Creator ────────────────────────────────
    try {
      const Creator = require('../models/Creator.js');
      const creatorDoc = await Creator.findOneAndUpdate(
        { guildId: g.id, userId: joinRecord.inviterId, joinCount: { $gt: 0 } },
        { $inc: { joinCount: -1 } },
        { new: true },
      );
      if (creatorDoc) {
        _log.info(`[Creator] ${member.user.tag} rời server — trừ 1 lượt Creator ${joinRecord.inviterId} — còn: ${creatorDoc.joinCount}`);
      }
    } catch (err) {
      _log.warn(`[Creator] Lỗi khi trừ joinCount: ${err.message}`);
    }
  } catch (err) {
    _log.error('[Invite] Lỗi guildMemberRemove:', err.message);
  }
}

// ─── Button handler ───────────────────────────────────────────────────────────

/**
 * Xử lý nút "👥 Mời bạn bè" (customId: 'setup_limit_invite').
 * deferReply (ephemeral) → xử lý async → editReply.
 */
async function handleInviteButton(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });
  const userId = interaction.user.id;

  try {
    let doc           = await UserInvite.findOne({ guildId: guild.id, userId });
    let discordInvite = null;

    // ── Thử tìm lại invite cũ còn tồn tại trên Discord ──────────────────────
    if (doc?.inviteCode) {
      try {
        const allInvites = await guild.invites.fetch();
        discordInvite = allInvites.get(doc.inviteCode) ?? null;
      } catch (_) {
        discordInvite = null;
      }
    }

    // ── Tạo invite mới nếu chưa có hoặc đã bị xóa ───────────────────────────
    if (!discordInvite) {
      const channel = _findInviteChannel(guild);
      if (!channel) {
        return interaction.editReply({
          embeds: [{
            color: 0xe74c3c,
            description: '❌ Bot không có quyền tạo link mời.\nVui lòng liên hệ Admin để cấp quyền **Tạo liên kết mời**.',
          }],
        });
      }

      discordInvite = await guild.invites.create(channel, {
        maxAge:  0,    // không hết hạn
        maxUses: 0,    // không giới hạn lượt dùng
        unique:  true,
        reason:  `Invite cá nhân cho ${interaction.user.tag}`,
      });

      // Lưu/cập nhật DB
      doc = await UserInvite.findOneAndUpdate(
        { guildId: guild.id, userId },
        {
          $set: {
            inviteCode: discordInvite.code,
            inviteURL:  `https://discord.gg/${discordInvite.code}`,
          },
          $setOnInsert: { uses: 0, joinedCount: 0, activeCount: 0, rewardProgress: 0 },
        },
        { upsert: true, new: true },
      );

      // Cập nhật cache để guildMemberAdd có thể so sánh đúng
      if (_cache) {
        const gMap = _cache.get(guild.id) ?? new Map();
        gMap.set(discordInvite.code, discordInvite.uses ?? 0);
        _cache.set(guild.id, gMap);
      }

      _log.info(`[Invite] Tạo invite mới ${discordInvite.code} cho user ${userId}`);
    }

    // ── Tính tiến trình ───────────────────────────────────────────────────────
    const activeCount    = Math.max(0, doc.activeCount ?? 0);
    const rewardProgress = doc.rewardProgress ?? 0;
    const progressVal    = Math.max(0, activeCount - rewardProgress * 5);

    const embed = {
      color: 0x5865f2,
      title: '👥 Mời bạn bè',
      description: [
        'Sao chép liên kết dưới đây và chia sẻ với bạn bè:',
        '',
        `\`https://discord.gg/${discordInvite.code}\``,
        '',
        `Tiến độ: ${progressVal}/5`,
        `👤 Đã mời thành công: ${doc.joinedCount ?? 0} người`,
      ].join('\n'),
      footer: { text: 'Nếu người được mời rời server, tiến độ sẽ bị trừ lại.' },
    };

    return interaction.editReply({ embeds: [embed] });

  } catch (err) {
    _log.error('[Invite] Lỗi handleInviteButton:', err.message);
    return interaction.editReply({
      embeds: [{
        color: 0xe74c3c,
        description: `❌ Đã xảy ra lỗi khi tạo link mời: ${err.message}`,
      }],
    });
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Kiểm tra và cộng thưởng mốc 5 người active.
 * Mỗi lần activeCount vượt qua bội số của 5 → +500 lượt, rewardProgress++.
 * Dùng $set để tránh thưởng trùng khi có race condition.
 */
async function _checkAndAwardMilestone(guildId, inviterId, inviteDoc) {
  const milestonesEarned = Math.floor(inviteDoc.activeCount / 5);
  if (milestonesEarned <= (inviteDoc.rewardProgress ?? 0)) return;

  const newMilestones = milestonesEarned - inviteDoc.rewardProgress;
  const bonus         = newMilestones * 500;

  // Cập nhật rewardProgress trước để tránh thưởng trùng
  await UserInvite.updateOne(
    { guildId, userId: inviterId },
    { $set: { rewardProgress: milestonesEarned } },
  );

  _log.success(
    `[Invite] +${bonus} lượt cho ${inviterId} — mốc ${milestonesEarned * 5} active`,
  );

  // DM thông báo
  try {
    const user = await _botClient.users.fetch(inviterId);
    await user.send(
      `🎉 Bạn vừa đạt mốc **${inviteDoc.activeCount} người** đang ở lại server! Cảm ơn bạn đã phát triển cộng đồng!`,
    );
  } catch (_) { /* DM bị tắt */ }

  // Gửi embed thông báo công khai vào kênh chỉ định
  try {
    const publicChannel = await _botClient.channels.fetch('1512902714873352373');
    if (publicChannel?.isTextBased()) {
      const publicEmbed = {
        color: 0xf1c40f,
        title: '🎉 CHÚC MỪNG THÀNH VIÊN NHẬN THƯỞNG',
        description: [
          `👤 Người dùng: <@${inviterId}>`,
          `👥 Đã mời thành công: 05 người`,
          'Cảm ơn bạn đã đồng hành và phát triển cộng đồng!',
        ].join('\n'),
      };
      await publicChannel.send({ embeds: [publicEmbed] });
    }
  } catch (err) {
    _log.warn(`[Invite] Không thể gửi embed công khai: ${err.message}`);
  }
}

/** Tìm kênh text mà bot có quyền CREATE_INSTANT_INVITE. Ưu tiên systemChannel. */
function _findInviteChannel(guild) {
  const me = guild.members.me;
  if (!me) return null;

  if (guild.systemChannel) {
    const p = guild.systemChannel.permissionsFor(me);
    if (p?.has('CREATE_INSTANT_INVITE')) return guild.systemChannel;
  }

  return guild.channels.cache.find(c => {
    if (c.type !== 'GUILD_TEXT') return false;
    const p = c.permissionsFor(me);
    return p?.has('CREATE_INSTANT_INVITE') && p?.has('VIEW_CHANNEL');
  }) ?? null;
}

/** Thanh tiến trình emoji. buildProgressBar(3,5) → "🟩🟩🟩⬜⬜" */
function _buildProgressBar(current, total) {
  const filled = Math.min(Math.max(0, current), total);
  return '🟩'.repeat(filled) + '⬜'.repeat(total - filled);
}

// ─── UsageLimit invite milestone ──────────────────────────────────────────────

/**
 * Kiểm tra và cộng thưởng mốc "3 người mới" cho UsageLimit.
 *
 * Logic mới (reset-based, không tích lũy):
 *  - Chỉ tính những người chưa được đánh dấu vào countedMemberIds (người "mới").
 *  - Khi đủ 3 người mới đang active: cộng +300 lượt, đánh dấu 3 người đó
 *    vào countedMemberIds, giảm newActiveCount đi 3.
 *  - Người cũ đã được tính mốc trước (đã trong countedMemberIds) vào lại
 *    server sẽ KHÔNG được tính vào mốc tiếp theo.
 */
async function _checkUsageLimitMilestone(guildId, inviterId, inviteDoc) {
  try {
    const UsageLimit = require('../models/UsageLimit.js');
    const newActiveCount = Math.max(0, inviteDoc.newActiveCount ?? 0);
    if (newActiveCount < 3) return;

    // Số mốc có thể thưởng trong lần này
    const milestones = Math.floor(newActiveCount / 3);
    const bonus      = milestones * 300;

    // Lấy các JoinRecord của người chưa được tính (không có trong countedMemberIds)
    const countedMemberIds = inviteDoc.countedMemberIds || [];
    const uncountedRecords = await JoinRecord.find({
      guildId,
      inviterId,
      userId: { $nin: countedMemberIds },
    }).limit(milestones * 3).lean();

    const newCountedIds = uncountedRecords.map(r => r.userId);
    if (newCountedIds.length < 3) return; // phòng trường hợp race condition

    // Đánh dấu các thành viên này vào countedMemberIds + giảm newActiveCount
    await UserInvite.updateOne(
      { guildId, userId: inviterId },
      {
        $addToSet: { countedMemberIds: { $each: newCountedIds } },
        $inc:      { newActiveCount: -(milestones * 3) },
      },
    );

    // Cộng +300 lượt vào UsageLimit
    const now = new Date();
    await UsageLimit.findOneAndUpdate(
      { guildId, userId: inviterId },
      {
        $inc:         { uses: bonus, inviteMilestonesAwarded: milestones },
        $setOnInsert: { lastReset: now },
      },
      { upsert: true },
    );

    _log?.success(
      `[UsageLimit] +${bonus} lượt cho ${inviterId}` +
      ` (${milestones} mốc × 3 người mới — ${newCountedIds.length} người được đánh dấu)`,
    );
  } catch (err) {
    _log?.error('[UsageLimit] Lỗi _checkUsageLimitMilestone:', err.message);
  }
}

/**
 * Xử lý nút "Mời Bạn Bè" từ embed hết lượt (customId: 'usageLimit_invite').
 * Tạo / lấy lại invite cá nhân và hiển thị tiến độ 0/3 người.
 */
async function handleUsageLimitInviteButton(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });
  const userId = interaction.user.id;

  try {
    const UsageLimit = require('../models/UsageLimit.js');

    let doc           = await UserInvite.findOne({ guildId: guild.id, userId });
    let discordInvite = null;

    // Thử tìm lại invite cũ còn tồn tại trên Discord
    if (doc?.inviteCode) {
      try {
        const all = await guild.invites.fetch();
        discordInvite = all.get(doc.inviteCode) ?? null;
      } catch (_) { discordInvite = null; }
    }

    // Tạo invite mới nếu chưa có hoặc đã bị xóa
    if (!discordInvite) {
      const channel = _findInviteChannel(guild);
      if (!channel) {
        return interaction.editReply({
          embeds: [{ color: 0xe74c3c, description: '❌ Bot không có quyền tạo link mời.\nVui lòng liên hệ Admin để cấp quyền **Tạo liên kết mời**.' }],
        });
      }

      discordInvite = await guild.invites.create(channel, {
        maxAge: 0, maxUses: 0, unique: true,
        reason: `Invite cá nhân (UsageLimit) cho ${interaction.user.tag}`,
      });

      doc = await UserInvite.findOneAndUpdate(
        { guildId: guild.id, userId },
        {
          $set:          { inviteCode: discordInvite.code, inviteURL: `https://discord.gg/${discordInvite.code}` },
          $setOnInsert:  { uses: 0, joinedCount: 0, activeCount: 0, rewardProgress: 0 },
        },
        { upsert: true, new: true },
      );

      if (_cache) {
        const gMap = _cache.get(guild.id) ?? new Map();
        gMap.set(discordInvite.code, discordInvite.uses ?? 0);
        _cache.set(guild.id, gMap);
      }
      _log?.info(`[UsageLimit] Tạo invite ${discordInvite.code} cho user ${userId}`);
    }

    // Tiến độ đến mốc 3 người tiếp theo (dùng newActiveCount — người chưa được tính)
    const progress = Math.max(0, Math.min(3, doc?.newActiveCount ?? 0));

    const embed = {
      color: 0x5865f2,
      description: [
        '### Link mời của bạn',
        '',
        `\`https://discord.gg/${discordInvite.code}\``,
        '',
        `Tiến độ: **${progress} / 3 người**`,
        '',
        '**Hãy mời 03 người bạn vào sever bằng link trên để nhận 300 lượt sử dụng miễn phí nhé**',
      ].join('\n'),
    };

    return interaction.editReply({ embeds: [embed] });
  } catch (err) {
    _log?.error('[UsageLimit] Lỗi handleUsageLimitInviteButton:', err.message);
    return interaction.editReply({
      embeds: [{ color: 0xe74c3c, description: `❌ Lỗi khi tạo link mời: ${err.message}` }],
    });
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  init,
  handleInviteCreate,
  handleInviteDelete,
  handleGuildMemberAdd,
  handleGuildMemberRemove,
  handleInviteButton,
  handleUsageLimitInviteButton,
};
