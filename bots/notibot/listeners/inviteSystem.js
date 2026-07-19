/**
 * inviteSystem.js — Hệ thống "Mời bạn bè" hoàn chỉnh
 *
 * Export:
 *   init(inviteCache, log, botClient)  — gọi 1 lần sau khi bot ready
 *   handleInviteCreate(invite)
 *   handleInviteDelete(invite)
 *   handleGuildMemberAdd(member)
 *   handleGuildMemberRemove(member)
 *   handleInviteButton(interaction, guild)
 */

const UsageLimit  = require('../models/UsageLimit.js');
const JoinRecord  = require('../models/JoinRecord.js');
const UserInvite  = require('../models/UserInvite.js');

// ─── Module-level state (injected via init) ───────────────────────────────────

/** @type {Map<string, Map<string, { uses: number, inviterId: string|null }>>} */
let _cache      = null;
let _log        = null;
let _botClient  = null;

/**
 * Khởi tạo module. Phải gọi sau khi bot ready và inviteCache đã được populate.
 * @param {Map}    inviteCache  - Map<guildId, Map<code, {uses, inviterId}>> dùng chung với index.js
 * @param {object} log          - logger object ({ info, warn, error, success })
 * @param {Client} botClient    - discord.js BotClient instance
 */
function init(inviteCache, log, botClient) {
  _cache     = inviteCache;
  _log       = log;
  _botClient = botClient;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

/** Cập nhật cache khi có invite mới được tạo */
function handleInviteCreate(invite) {
  const guildId = invite.guild?.id;
  if (!guildId || !_cache) return;
  const gMap = _cache.get(guildId) || new Map();
  gMap.set(invite.code, { uses: invite.uses || 0, inviterId: invite.inviter?.id ?? null });
  _cache.set(guildId, gMap);
}

/** Xóa invite khỏi cache khi bị xóa */
function handleInviteDelete(invite) {
  const guildId = invite.guild?.id;
  if (!guildId || !_cache) return;
  const gMap = _cache.get(guildId);
  if (gMap) gMap.delete(invite.code);
}

// ─── guildMemberAdd ───────────────────────────────────────────────────────────

/**
 * Khi có người vào server:
 * 1. So sánh cache trước/sau để tìm invite được dùng
 * 2. Cập nhật joinedCount, activeCount của chủ invite
 * 3. Thưởng +50 lượt cho mỗi mốc 5 activeCount (không thưởng trùng)
 */
async function handleGuildMemberAdd(member) {
  const g = member.guild;
  try {
    const cachedInvites = _cache.get(g.id) || new Map();

    // Fetch invite list mới nhất từ Discord
    let freshInvites;
    try {
      freshInvites = await g.invites.fetch();
    } catch (err) {
      _log.warn(`[Invite] Không thể fetch invite cho ${g.name}: ${err.message}`);
      return;
    }

    // Tìm invite có số uses tăng so với cache
    let usedInvite = null;
    freshInvites.forEach(inv => {
      const cached = cachedInvites.get(inv.code);
      if ((cached && inv.uses > cached.uses) || (!cached && inv.uses > 0)) {
        usedInvite = inv;
      }
    });

    // Refresh toàn bộ cache với dữ liệu mới nhất
    const newMap = new Map();
    freshInvites.forEach(inv => newMap.set(inv.code, {
      uses: inv.uses,
      inviterId: inv.inviter?.id ?? null,
    }));
    _cache.set(g.id, newMap);

    if (!usedInvite || !usedInvite.inviter) return;

    const inviterId   = usedInvite.inviter.id;
    const inviteCode  = usedInvite.code;
    const inviteURL   = `https://discord.gg/${inviteCode}`;
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Lưu JoinRecord để có thể trừ lại khi người này rời
    try {
      await JoinRecord.create({ guildId: g.id, userId: member.id, inviterId, inviteCode });
    } catch (_) { /* duplicate — bỏ qua */ }

    // Tăng joinedCount + activeCount, sync inviteCode/URL, lấy doc mới
    const inviteDoc = await UserInvite.findOneAndUpdate(
      { guildId: g.id, userId: inviterId },
      {
        $inc: { joinedCount: 1, activeCount: 1 },
        $set: { inviteCode, inviteURL },
        $setOnInsert: { uses: 0, rewardProgress: 0 },
      },
      { upsert: true, new: true },
    );

    _log.info(
      `[Invite] ${member.user.tag} vào server qua invite của ` +
      `${usedInvite.inviter.tag} — active: ${inviteDoc.activeCount}`,
    );

    // ── Kiểm tra thưởng mốc 5 người ──────────────────────────────────────────
    const milestonesEarned = Math.floor(inviteDoc.activeCount / 5);
    if (milestonesEarned > inviteDoc.rewardProgress) {
      const newMilestones = milestonesEarned - inviteDoc.rewardProgress;
      const bonus         = newMilestones * 50;

      // Cập nhật rewardProgress atomically để tránh thưởng trùng
      await UserInvite.updateOne(
        { guildId: g.id, userId: inviterId },
        { $set: { rewardProgress: milestonesEarned } },
      );

      // Cộng lượt vào UsageLimit
      await UsageLimit.findOneAndUpdate(
        { guildId: g.id, userId: inviterId },
        {
          $inc: { remainingUses: bonus },
          $setOnInsert: {
            monthlyLimit: 50,
            lastResetMonth: currentMonth,
            pendingInviteRewards: 0,
            totalInvites: 0,
          },
        },
        { upsert: true },
      );

      _log.success(
        `[Invite] +${bonus} lượt cho ${inviterId} — đạt mốc ` +
        `${milestonesEarned * 5} người active`,
      );

      // Gửi DM thông báo cho chủ invite
      try {
        const inviterUser = await _botClient.users.fetch(inviterId);
        await inviterUser.send(
          `🎉 Chúc mừng! Bạn vừa đạt **${inviteDoc.activeCount} người** đang ở lại server!\n` +
          `**+${bonus} lượt** tùy chỉnh thông báo đã được cộng vào tài khoản của bạn.`,
        );
      } catch (_) { /* DM bị tắt — bỏ qua */ }
    }
  } catch (err) {
    _log.error('[Invite] Lỗi guildMemberAdd:', err.message);
  }
}

// ─── guildMemberRemove ────────────────────────────────────────────────────────

/**
 * Khi có người rời server:
 * 1. Tìm JoinRecord để biết họ vào qua invite của ai
 * 2. Giảm activeCount của chủ invite
 * (rewardProgress KHÔNG giảm — mốc thưởng đã cộng không bị thu hồi)
 */
async function handleGuildMemberRemove(member) {
  const g = member.guild;
  try {
    const joinRecord = await JoinRecord.findOneAndDelete({ guildId: g.id, userId: member.id });
    if (!joinRecord || !joinRecord.inviterId) return;

    const updated = await UserInvite.findOneAndUpdate(
      { guildId: g.id, userId: joinRecord.inviterId },
      { $inc: { activeCount: -1 } },
      { new: true },
    );

    // Đảm bảo activeCount không âm
    if (updated && updated.activeCount < 0) {
      await UserInvite.updateOne(
        { guildId: g.id, userId: joinRecord.inviterId },
        { $set: { activeCount: 0 } },
      );
    }

    _log.info(
      `[Invite] ${member.user.tag} rời server — ` +
      `active của ${joinRecord.inviterId}: ${Math.max(0, updated?.activeCount ?? 0)}`,
    );
  } catch (err) {
    _log.error('[Invite] Lỗi guildMemberRemove:', err.message);
  }
}

// ─── Button handler ───────────────────────────────────────────────────────────

/**
 * Xử lý nút "👥 Mời bạn bè" (customId: 'setup_limit_invite')
 * Luôn dùng deferReply ephemeral → editReply để tránh timeout.
 */
async function handleInviteButton(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;

  try {
    let doc           = await UserInvite.findOne({ guildId: guild.id, userId });
    let discordInvite = null;

    // ── Thử lấy lại invite cũ từ Discord ─────────────────────────────────────
    if (doc?.inviteCode) {
      try {
        // guild.invites.fetch() trả về Collection; lọc theo code
        const allInvites = await guild.invites.fetch();
        discordInvite = allInvites.get(doc.inviteCode) ?? null;
      } catch (_) {
        discordInvite = null;
      }
    }

    // ── Tạo invite mới nếu chưa có hoặc đã bị xóa ────────────────────────────
    if (!discordInvite) {
      const channel = _findInviteChannel(guild);
      if (!channel) {
        return interaction.editReply({
          embeds: [{
            color: 0xe74c3c,
            description: '❌ Bot không có quyền tạo link mời trên server này.\nVui lòng liên hệ Admin để cấp quyền **Tạo liên kết mời**.',
          }],
        });
      }

      discordInvite = await guild.invites.create(channel, {
        maxAge:  0,   // không hết hạn
        maxUses: 0,   // không giới hạn lượt dùng
        unique:  true,
        reason:  `Invite cá nhân cho ${interaction.user.tag}`,
      });

      // Lưu/cập nhật vào DB
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

      // Cập nhật cache
      if (_cache && guild.id) {
        const gMap = _cache.get(guild.id) || new Map();
        gMap.set(discordInvite.code, { uses: 0, inviterId: userId });
        _cache.set(guild.id, gMap);
      }
    }

    // ── Tính tiến trình thưởng ────────────────────────────────────────────────
    const activeCount     = Math.max(0, doc.activeCount);
    const rewardProgress  = doc.rewardProgress ?? 0;
    // progress = active hiện tại trừ đi các mốc đã thưởng
    const progressVal     = Math.max(0, activeCount - rewardProgress * 5);
    const progressBar     = buildProgressBar(progressVal, 5);

    // ── Tạo embed ─────────────────────────────────────────────────────────────
    const embed = {
      color: 0x5865f2,
      title: '👥 Mời bạn bè để nhận thêm lượt',
      description: [
        'Sao chép link dưới đây và chia sẻ với bạn bè:',
        '',
        `\`https://discord.gg/${discordInvite.code}\``,
        '',
        `${progressBar} **${progressVal}/5**`,
        `👤 **Đã mời:** ${doc.joinedCount} người`,
        '',
        '🎁 Đủ **5 người ở lại** server sẽ nhận **+50 lượt** dùng tính năng thông báo.',
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
 * Tìm kênh text đầu tiên mà bot có quyền CREATE_INSTANT_INVITE.
 * Ưu tiên systemChannel của guild.
 */
function _findInviteChannel(guild) {
  const me = guild.me;
  if (!me) return null;

  // Ưu tiên system channel
  if (guild.systemChannel) {
    const perms = guild.systemChannel.permissionsFor(me);
    if (perms && perms.has('CREATE_INSTANT_INVITE')) return guild.systemChannel;
  }

  // Fallback: kênh text bất kỳ có quyền
  return guild.channels.cache.find(c => {
    if (c.type !== 'GUILD_TEXT') return false;
    const perms = c.permissionsFor(me);
    return perms && perms.has('CREATE_INSTANT_INVITE') && perms.has('VIEW_CHANNEL');
  }) ?? null;
}

/**
 * Tạo thanh tiến trình dạng emoji.
 * Ví dụ: progressBar(3, 5) → "🟩🟩🟩⬜⬜"
 */
function buildProgressBar(current, total) {
  const filled = Math.min(current, total);
  const empty  = total - filled;
  return '🟩'.repeat(filled) + '⬜'.repeat(empty);
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
