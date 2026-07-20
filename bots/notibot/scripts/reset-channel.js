/**
 * reset-channel.js
 * Xoá toàn bộ tin nhắn trong kênh và gửi text quy định mới.
 * Chạy: node scripts/reset-channel.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client, Intents } = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = '1517539125849358406';

const NEW_MESSAGE =
`Mọi thành viên đều có thể đăng bài trao đổi tại đây.
Cấm mua bán hoặc đăng giá bằng tiền thật (ví dụ: 20k, 100k, 40, 70).
Chỉ được trao đổi bằng xu, nông sản hoặc các vật phẩm.
🔰Nếu bạn cần hỗ trợ giao dịch an toàn? Truy cập [tại đây](https://discord.com/channels/1363986043509932093/1526507160782114937) để được hỗ trợ nhanh và uy tín nhất nhé.`;

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

client.once('ready', async () => {
  console.log(`[Bot] Đăng nhập: ${client.user.tag}`);

  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel || !channel.isText()) {
    console.error('Không tìm thấy kênh hoặc kênh không phải text channel.');
    process.exit(1);
  }

  console.log(`[Bot] Đang xoá tin nhắn trong kênh: #${channel.name}`);

  // Xoá từng batch tin nhắn (tối đa 100 mỗi lần, bulk delete cho tin < 14 ngày)
  let deleted = 0;
  while (true) {
    const messages = await channel.messages.fetch({ limit: 100 });
    if (messages.size === 0) break;

    // Tách tin < 14 ngày (bulk delete) và tin cũ hơn (xoá từng cái)
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recent = messages.filter(m => m.createdTimestamp > twoWeeksAgo);
    const old = messages.filter(m => m.createdTimestamp <= twoWeeksAgo);

    if (recent.size > 1) {
      await channel.bulkDelete(recent, true);
      deleted += recent.size;
    } else if (recent.size === 1) {
      await recent.first().delete();
      deleted += 1;
    }

    for (const msg of old.values()) {
      await msg.delete().catch(() => {});
      deleted += 1;
      await new Promise(r => setTimeout(r, 500)); // tránh rate limit
    }

    if (messages.size < 100) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[Bot] Đã xoá ${deleted} tin nhắn.`);

  // Gửi text mới
  await channel.send(NEW_MESSAGE);
  console.log('[Bot] Đã gửi text quy định mới. Hoàn tất!');

  client.destroy();
  process.exit(0);
});

client.login(BOT_TOKEN);
