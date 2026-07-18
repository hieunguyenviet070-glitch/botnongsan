module.exports = {
  // Token tài khoản Discord (Selfbot) — đọc từ environment secret
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || "",
  // Token Bot Discord — đọc từ environment secret
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  // Danh sách các ID Discord Admin
  ADMIN_IDS: process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : ["1122110156847726632"]
};
