'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client, Intents } = require('discord.js');

const CHANNEL_ID = '1517539125849358406';
const NEW_MESSAGE =
`Mọi thành viên đều có thể đăng bài trao đổi tại đây.
Cấm mua bán hoặc đăng giá bằng tiền thật (ví dụ: 20k, 100k, 40, 70).
Chỉ được trao đổi bằng xu, nông sản hoặc các vật phẩm.
🔰Nếu bạn cần hỗ trợ giao dịch an toàn? Truy cập [tại đây](https://discord.com/channels/1363986043509932093/1526507160782114937) để được hỗ trợ nhanh và uy tín nhất nhé.`;

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });
client.once('ready', async () => {
  const ch = await client.channels.fetch(CHANNEL_ID);
  await ch.send(NEW_MESSAGE);
  console.log('Đã gửi!');
  client.destroy();
});
client.login(process.env.BOT_TOKEN);
