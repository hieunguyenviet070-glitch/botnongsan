/**
 * Listener: Embed nhắc nhở tự động cho kênh #🔁｜trao-đổi-khác
 * - Mỗi khi có thành viên (không phải bot) nhắn tin, xóa embed cũ và gửi embed mới.
 * - Không lưu DB, không ảnh hưởng các listener khác.
 */

const REMINDER_CHANNEL_ID = '1517539125849358406';

// Lưu messageId của embed nhắc nhở hiện tại trong bộ nhớ
let lastReminderMessageId = null;

const REMINDER_EMBED = {
  color: 0x5865f2,
  description: [
    '━━━━━━━━━━━━━━━━━━',
    '',
    '🔁 **KÊNH TRAO ĐỔI KHÁC**',
    '',
    'Mọi thành viên đều có thể đăng bài trao đổi tại đây.',
    '',
    'Cấm mua bán hoặc đăng giá bằng tiền thật (ví dụ: 20k, 100k, 40, 70).',
    '',
    'Chỉ được trao đổi bằng xu, nông sản hoặc các vật phẩm.',
    '🔰Nếu bạn cần hỗ trợ giao dịch an toàn? Truy cập [tại đây](https://discord.com/channels/1363986043509932093/1526507160782114937) để được hỗ trợ nhanh và uy tín nhất nhé.',
    '',
    '━━━━━━━━━━━━━━━━━━',
  ].join('\n'),
};

/**
 * Xử lý sự kiện messageCreate trên botClient.
 * Gọi hàm này từ botClient.on('messageCreate', ...) trong index.js.
 *
 * @param {import('discord.js').Message} message
 */
async function handleReminderEmbed(message) {
  // Chỉ hoạt động tại kênh chỉ định
  if (message.channel.id !== REMINDER_CHANNEL_ID) return;
  // Bỏ qua tin nhắn của bot
  if (message.author.bot) return;

  const channel = message.channel;

  // Xóa embed nhắc nhở cũ nếu đang có
  if (lastReminderMessageId) {
    try {
      const old = await channel.messages.fetch(lastReminderMessageId);
      if (old && old.deletable) await old.delete();
    } catch (_) {
      // Tin nhắn cũ đã bị xóa thủ công — bỏ qua
    }
    lastReminderMessageId = null;
  }

  // Gửi embed nhắc nhở mới
  try {
    const sent = await channel.send({ embeds: [REMINDER_EMBED] });
    lastReminderMessageId = sent.id;
  } catch (_) {
    // Bot thiếu quyền gửi — bỏ qua
  }
}

module.exports = { handleReminderEmbed };
