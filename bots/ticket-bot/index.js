require('dotenv').config();
const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionsBitField, ChannelType
} = require('discord.js');

const TOKEN          = process.env.TOKEN || process.env.BOT_TOKEN;
const CLIENT_ID      = process.env.CLIENT_ID;
const MANAGER_ROLE   = process.env.MANAGER_ROLE_ID;

if (!TOKEN)     { console.error('[TICKET] ❌ Thiếu TOKEN trong .env!');     process.exit(1); }
if (!CLIENT_ID) { console.error('[TICKET] ❌ Thiếu CLIENT_ID trong .env!'); process.exit(1); }

// ─────────────────────────────────────────────────────────────────
// Đăng ký Slash Command
// ─────────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Gửi bảng ticket hệ thống shop')
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('[TICKET] ✅ Đã đăng ký slash command /shop!');
  } catch (err) {
    console.error('[TICKET] ❌ Lỗi đăng ký slash command:', err.message);
  }
})();

// ─────────────────────────────────────────────────────────────────
// Discord Client
// ─────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

/** userId  → channelId  (ticket đang mở) */
const openTickets = new Map();
/** channelId → userId   (ai sở hữu ticket) */
const ticketOwners = new Map();

client.once('ready', () => {
  console.log(`[TICKET] ✅ Đã đăng nhập: ${client.user.tag}`);
});

// ─────────────────────────────────────────────────────────────────
// Xử lý Interaction
// ─────────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

  // ── /shop ──────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'shop') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setDescription(
        `## TICKET SYSTEM | PLAYHUB <a:tichdo:1532847924978126989>\n\n` +
        `### HƯỚNG DẪN\n` +
        `Nếu bạn ưng ý một số món đồ của sốp, xin hãy vui lòng ấn vào **"Trao Đổi"**.\n\n` +
        `Nếu bạn có vấn đề cần hỗ trợ, vui lòng tạo ticket **"Hỗ Trợ"**.\n\n` +
        `### XIN LƯU Ý\n` +
        `<:exclamation:1532333725155856556> Hãy nói rõ mặt hàng bạn cần trao đổi sau khi tạo ticket.\n\n` +
        `<:exclamation:1532333725155856556> Vui lòng không tạo ticket nếu bạn không có nhu cầu hoặc không có vấn đề cần giúp đỡ.`
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_trade')
        .setLabel('Trao Đổi')
        .setEmoji({ id: '1532844428480352409', name: '575241fastflashingarrowright', animated: true })
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('ticket_support')
        .setLabel('Hỗ Trợ')
        .setEmoji({ id: '1533007855622291486', name: 'hotro' })
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
    return;
  }

  // ── Buttons ────────────────────────────────────────────────────
  if (interaction.isButton()) {

    // Nút Trao Đổi → mở modal
    if (interaction.customId === 'ticket_trade') {
      const modal = new ModalBuilder()
        .setCustomId('modal_trade')
        .setTitle('Sản phẩm bạn muốn trao đổi là gì?');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('product_input')
            .setLabel('Sản phẩm')
            .setPlaceholder('Ví dụ: Cày thẻ, buff tim...')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return;
    }

    // Nút Hỗ Trợ → mở modal
    if (interaction.customId === 'ticket_support') {
      const modal = new ModalBuilder()
        .setCustomId('modal_support')
        .setTitle('Bạn cần hỗ trợ gì vậy ạ?');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('support_input')
            .setLabel('Vấn đề')
            .setPlaceholder('Ví dụ: Mô tả chi tiết lỗi hoặc yêu cầu...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return;
    }

    // Nút Đóng Ticket
    if (interaction.customId === 'close_ticket') {
      const channelId = interaction.channel.id;
      const ownerId   = ticketOwners.get(channelId);
      if (ownerId) {
        openTickets.delete(ownerId);
        ticketOwners.delete(channelId);
      }
      await interaction.reply({
        content: '🔒 Ticket sẽ được **đóng** và **xóa** sau **5 giây**...'
      });
      setTimeout(async () => {
        try { await interaction.channel.delete('Ticket đã được đóng.'); } catch (_) {}
      }, 5000);
      return;
    }
  }

  // ── Modal Submit ───────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    const userId  = interaction.user.id;
    const isTrade = interaction.customId === 'modal_trade';

    // Kiểm tra ticket đang mở
    if (openTickets.has(userId)) {
      const existingId = openTickets.get(userId);
      const existing   = interaction.guild.channels.cache.get(existingId);
      if (existing) {
        return await interaction.reply({
          content: `❌ Bạn đã có ticket đang mở tại <#${existingId}>!\nVui lòng đóng ticket đó trước khi tạo ticket mới.`,
          ephemeral: true
        });
      }
      // Kênh đã bị xóa bên ngoài → dọn dẹp map
      openTickets.delete(userId);
    }

    const inputValue  = isTrade
      ? interaction.fields.getTextInputValue('product_input')
      : interaction.fields.getTextInputValue('support_input');
    const ticketLabel = isTrade ? 'Trao Đổi' : 'Hỗ Trợ';

    // Tên kênh an toàn
    const safeName = interaction.user.username
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'user';

    // Quyền kênh
    const permissionOverwrites = [
      { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      {
        id: userId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      },
      {
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels
        ]
      }
    ];
    if (MANAGER_ROLE) {
      permissionOverwrites.push({
        id: MANAGER_ROLE,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      });
    }

    await interaction.deferReply({ ephemeral: true });

    // Tạo kênh riêng tư
    const channel = await interaction.guild.channels.create({
      name: `🛒・${safeName}`,
      type: ChannelType.GuildText,
      parent: interaction.channel.parentId ?? null,
      permissionOverwrites
    });

    openTickets.set(userId, channel.id);
    ticketOwners.set(channel.id, userId);

    // Embed chào mừng
    const welcomeEmbed = new EmbedBuilder()
      .setColor(isTrade ? 0x5865F2 : 0xFEE75C)
      .setTitle(`🎫 Ticket ${ticketLabel} — ${interaction.user.displayName}`)
      .setDescription(
        `Chào <@${userId}>! Ticket của bạn đã được tạo thành công.\n\n` +
        `**Loại:** ${ticketLabel}\n` +
        `**Nội dung:** ${inputValue}\n\n` +
        `Nhân viên hỗ trợ sẽ đến trong giây lát. Vui lòng chờ đợi! 🙏`
      )
      .setFooter({ text: 'Bấm nút bên dưới để đóng ticket khi không còn cần thiết.' })
      .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Đóng Ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
    );

    const mention = MANAGER_ROLE
      ? `<@${userId}> <@&${MANAGER_ROLE}>`
      : `<@${userId}>`;

    await channel.send({ content: mention, embeds: [welcomeEmbed], components: [closeRow] });

    await interaction.editReply({
      content: `✅ Ticket đã được tạo tại <#${channel.id}>!`
    });
  }
});

client.login(TOKEN).catch(err => {
  console.error('[TICKET] ❌ Không thể đăng nhập:', err.message);
  process.exit(1);
});
