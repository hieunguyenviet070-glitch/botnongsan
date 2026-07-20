/**
 * Gỡ role thông báo và gửi DM cho người dùng khi hết lượt sử dụng.
 */

const REVOCABLE_ROLE_IDS = [
  '1523935568814149723',
  '1523935570290802761',
  '1523935571427332098',
  '1523935573356843138',
  '1523935574916993036',
  '1523935576917545081',
  '1523935578419363944',
  '1523935580772368465',
  '1523935582429118495',
  '1523935584077217824',
  '1523935585536835625',
  '1523935587499769876',
  '1523935589232283759',
  '1523935590981304480',
  '1523935592923004968',
  '1523935593992552482',
  '1523935596039639090',
  '1523935597557973012',
  '1523935599231242300',
  '1523935601194176633',
  '1523935602913837197',
  '1523935605577220176',
  '1523935607326249010',
  '1523935609054298185',
  '1523935610803458068',
  '1523935612120338526',
  '1523935615803064350',
  '1523935619070427306',
  '1523935620454420602',
  '1523935617375932570',
  '1523935622203572254',
  '1523935623625314357',
  '1523935625135525962',
  '1523935627320623164',
  '1523935629145145434',
  '1523935613961895936',
];

/**
 * Gỡ toàn bộ role thông báo khỏi member (chỉ các role trong REVOCABLE_ROLE_IDS
 * mà member đang có) rồi gửi DM thông báo cho họ.
 *
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<number>} Số role đã gỡ thực tế
 */
async function revokeNotificationRoles(member) {
  // Chỉ gỡ những role member đang có
  const toRemove = REVOCABLE_ROLE_IDS.filter(id => member.roles.cache.has(id));
  if (toRemove.length === 0) return 0;

  for (const id of toRemove) {
    try {
      await member.roles.remove(id, 'Hết lượt sử dụng thông báo tháng này');
    } catch (_) {
      // Bỏ qua: bot thiếu quyền hoặc role không còn tồn tại
    }
  }

  // Gửi DM cho người dùng
  try {
    await member.send({
      embeds: [{
        color: 0xe74c3c,
        title: '⚠️ Bạn đã hết lượt sử dụng thông báo',
        description: [
          `Lượt sử dụng thông báo của bạn trên server **${member.guild.name}** đã về **0**.`,
          '',
          `**${toRemove.length} role thông báo** của bạn đã được tự động thu hồi.`,
          '',
          '🗓️ Lượt sử dụng sẽ được đặt lại vào đầu tháng sau.',
          '🎁 Bạn có thể nhận thêm lượt bằng cách mời bạn bè tham gia server.',
        ].join('\n'),
        footer: { text: 'PlayHub Notification System' },
        timestamp: new Date(),
      }]
    });
  } catch (_) {
    // DM bị tắt hoặc bot bị chặn — bỏ qua
  }

  return toRemove.length;
}

module.exports = { revokeNotificationRoles, REVOCABLE_ROLE_IDS };
