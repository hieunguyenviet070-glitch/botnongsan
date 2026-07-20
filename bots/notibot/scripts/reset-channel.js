/**
 * reset-channel.js
 * Xoá toàn bộ tin nhắn trong kênh và gửi text quy định mới.
 * Chạy: node scripts/reset-channel.js
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client, Intents } = require('discord.js');

const BOT_TOKEN  = process.env.BOT_TOKEN;
const CHANNEL_ID = '1517539125849358406';

// Giữ nguyên hyperlink Discord Markdown, không thêm dòng trống thừa
const NEW_MESSAGE =
`Mọi thành viên đều có thể đăng bài trao đổi tại đây.
Cấm mua bán hoặc đăng giá bằng tiền thật (ví dụ: 20k, 100k, 40, 70).
Chỉ được trao đổi bằng xu, nông sản hoặc các vật phẩm.
🔰Nếu bạn cần hỗ trợ giao dịch an toàn? Truy cập [tại đây](https://discord.com/channels/1363986043509932093/1526507160782114937) để được hỗ trợ nhanh và uy tín nhất nhé.`;

const client = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES],
});

client.once('ready', async () => {
  console.log(`[Bot] Đăng nhập: ${client.user.tag}`);

  let channel;
  try {
    channel = await client.channels.fetch(CHANNEL_ID);
  } catch (e) {
    console.error('[Bot] Không fetch được kênh:', e.message);
    process.exit(1);
  }

  console.log(`[Bot] Kênh: #${channel.name}`);

  // Xoá tin nhắn theo từng batch 100 cho đến khi hết
  let totalDeleted = 0;
  const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

  while (true) {
    let messages;
    try {
      messages = await channel.messages.fetch({ limit: 100 });
    } catch (e) {
      console.error('[Bot] Fetch tin nhắn lỗi:', e.message);
      break;
    }
    if (messages.size === 0) break;

    const now = Date.now();
    const recent = messages.filter(m => now - m.createdTimestamp < TWO_WEEKS);
    const old    = messages.filter(m => now - m.createdTimestamp >= TWO_WEEKS);

    // Bulk delete tin < 14 ngày (tối đa 100)
    if (recent.size >= 2) {
      try {
        await channel.bulkDelete(recent, true);
        totalDeleted += recent.size;
        console.log(`[Bot] Bulk xoá ${recent.size} tin. Tổng: ${totalDeleted}`);
      } catch (e) {
        console.warn('[Bot] bulkDelete lỗi:', e.message);
      }
    } else if (recent.size === 1) {
      try { await recent.first().delete(); totalDeleted++; } catch (_) {}
    }

    // Xoá từng tin cũ (không cần delay — rate limit tự Discord xử lý qua queue)
    for (const msg of old.values()) {
      try { await msg.delete(); totalDeleted++; } catch (_) {}
    }

    if (messages.size < 100) break;
  }

  console.log(`[Bot] Đã xoá tổng ${totalDeleted} tin nhắn.`);

  // Gửi nội dung mới
  try {
    await channel.send(NEW_MESSAGE);
    console.log('[Bot] Đã gửi text quy định. Xong!');
  } catch (e) {
    console.error('[Bot] Gửi tin lỗi:', e.message);
  }

  client.destroy();
  process.exit(0);
});

client.on('error', e => console.error('[Bot] Client error:', e.message));

client.login(BOT_TOKEN).catch(e => {
  console.error('[Bot] Login lỗi:', e.message);
  process.exit(1);
});
