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

const UsageLimit = require('../models/UsageLimit.js');
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
      // Invite này không được tạo qua hệ thống bot — bỏ qua
      _log.info(`[Invite] Code ${usedCode} không có trong DB — bỏ qua.`);
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
    const inviteDoc = await UserInvite.findOneAndUpdate(
      { guildId: g.id, userId: inviterId },
      { $inc: { joinedCount: 1, activeCount: 1 } },
      { new: true },
    );

    _log.info(
      `[Invite] ${member.user.tag} vào server qua code ${usedCode}` +
      ` (chủ: ${inviterId}) — active: ${inviteDoc.activeCount}`,
    );

    // ── 8. Kiểm tra và cộng thưởng mốc 5 người ──────────────────────────────
    await _checkAndAwardMilestone(g.id, inviterId, inviteDoc);

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

    const updated = await UserInvite.findOneAndUpdate(
      { guildId: g.id, userId: joinRecord.inviterId },
      { $inc: { activeCount: -1 } },
      { new: true },
    );

    // Đảm bảo không âm
    if (updated && updated.activeCount < 0) {
      await UserInvite.updateOne(
        { guildId: g.id, userId: joinRecord.inviterId },
        { $set: { activeCount: 0 } },
      );
    }

    const finalCount = updated ? Math.max(0, updated.activeCount) : 0;
    _log.info(
      `[Invite] ${member.user.tag} rời server — ` +
      `active của ${joinRecord.inviterId}: ${finalCount}`,
    );
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
      title: '👥 Mời bạn bè để nhận thêm lượt',
      description: [
        'Sao chép link dưới đây và chia sẻ với bạn bè:',
        '',
        `\`https://discord.gg/${discordInvite.code}\``,
        '',
        `${_buildProgressBar(progressVal, 5)} **${progressVal}/5**`,
        `👤 **Đã mời:** ${doc.joinedCount ?? 0} người`,
        '',
        '🎁 Đủ **5 người ở lại** server sẽ nhận **+500 lượt** dùng tính năng thông báo.',
      ].join('\n'),
      footer: { text: 'Nếu người được mời rời server, tiến trình sẽ bị trừ lại.' },
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

  const currentMonth = new Date().toISOString().slice(0, 7);
  await UsageLimit.findOneAndUpdate(
    { guildId, userId: inviterId },
    {
      $inc: { remainingUses: bonus },
      $setOnInsert: {
        monthlyLimit:         50,
        lastResetMonth:       currentMonth,
        pendingInviteRewards: 0,
        totalInvites:         0,
      },
    },
    { upsert: true },
  );

  _log.success(
    `[Invite] +${bonus} lượt cho ${inviterId} — mốc ${milestonesEarned * 5} active`,
  );

  // DM thông báo
  try {
    const user = await _botClient.users.fetch(inviterId);
    await user.send(
      `🎉 Bạn vừa đạt mốc **${inviteDoc.activeCount} người** đang ở lại server!\n` +
      `**+${bonus} lượt** tùy chỉnh thông báo đã được cộng vào tài khoản của bạn.`,
    );
  } catch (_) { /* DM bị tắt */ }
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

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  init,
  handleInviteCreate,
  handleInviteDelete,
  handleGuildMemberAdd,
  handleGuildMemberRemove,
  handleInviteButton,
};
