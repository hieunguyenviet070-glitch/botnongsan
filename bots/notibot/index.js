const setup = require('./setup.js');
const { Client } = require('discord.js-selfbot-v13');
const { Client: BotClient, MessageActionRow, MessageButton, MessageSelectMenu } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { connectDB } = require('./db.js');
const JoinRecord = require('./models/JoinRecord.js');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};
function logTime() {
  const now = new Date();
  return `${colors.gray}[${now.toLocaleTimeString()}]${colors.reset}`;
}
const log = {
  info: (msg) => console.log(`${logTime()} ${colors.cyan}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${logTime()} ${colors.green}[SUCCESS]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${logTime()} ${colors.yellow}[WARN]${colors.reset} ${msg}`),
  error: (msg, err = '') => console.error(`${logTime()} ${colors.red}[ERROR]${colors.reset} ${msg}`, err),
  forward: () => { }
};
function printBanner() {
  console.log(`\n${colors.magenta}${colors.bright}==============================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}   DISCORD SELFBOT -> OFFICIAL BOT FORWARDER${colors.reset}`);
  console.log(`${colors.yellow}             Play Together Customizer${colors.reset}`);
  console.log(`${colors.magenta}${colors.bright}==============================================${colors.reset}\n`);
}
printBanner();
if (!fs.existsSync(CONFIG_PATH)) {
  log.error('Không tìm thấy file config.json! Vui lòng tạo file config.json trước.');
  process.exit(1);
}
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (config.channelMappings && Array.isArray(config.channelMappings)) {
    config.channelMappings = config.channelMappings.map(mapping => ({
      sourceChannelId: (mapping.sourceChannelId || '').trim(),
      targetChannelId: (mapping.targetChannelId || '').trim(),
      targetWebhookUrl: (mapping.targetWebhookUrl || '').trim(),
      type: (mapping.type || '').trim()
    })).filter(m => m.sourceChannelId !== '' && m.targetChannelId !== '');
  } else {
    config.channelMappings = [];
  }
} catch (error) {
  log.error('File config.json bị lỗi cấu hình hoặc lỗi cú pháp JSON!', error);
  process.exit(1);
}
const EMOJIS_PATH = path.join(__dirname, 'emojis.json');
let emojiConfig = { emojis: {}, roles: {} };
try {
  if (fs.existsSync(EMOJIS_PATH)) {
    emojiConfig = JSON.parse(fs.readFileSync(EMOJIS_PATH, 'utf8'));
  }
} catch (error) {
  log.warn('Lỗi đọc file emojis.json, sẽ sử dụng cấu hình mặc định.', error.message);
}
const discordToken = setup.DISCORD_TOKEN;
const botToken = setup.BOT_TOKEN;
if (!discordToken || discordToken === 'YOUR_DISCORD_TOKEN_HERE') {
  log.error('Vui lòng cấu hình Token Discord (Selfbot) trong file setup.js!');
  process.exit(1);
}
if (!botToken || botToken === 'YOUR_BOT_TOKEN_HERE') {
  log.error('Vui lòng cấu hình Token Bot Discord chính thức trong file setup.js!');
  process.exit(1);
}
if (config.channelMappings.length === 0) {
  log.error('Không tìm thấy cấu hình liên kết kênh (channelMappings) hợp lệ trong config.json!');
  process.exit(1);
}
const client = new Client({
  checkUpdate: false,
});
const botClient = new BotClient({
  intents: ['GUILDS', 'GUILD_MESSAGES', 'GUILD_MEMBERS', 'GUILD_INVITES']
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lastSentMessages = new Map();
// Map<guildId, Map<inviteCode, uses:number>>  — for invite tracking
const inviteCache = new Map();

const { handleReminderEmbed } = require('./listeners/reminderEmbed.js');
const inviteSystem = require('./listeners/inviteSystem.js');
const UserInvite = require('./models/UserInvite.js');
const UsageLimit = require('./models/UsageLimit.js');
const Creator = require('./models/Creator.js');
// ─────────────────────────────────────────────────────────────────────────────
function extractComponentText(components) {
  if (!components || !Array.isArray(components)) return '';
  let text = '';
  for (const comp of components) {
    if (comp.content) {
      text += (text ? '\n' : '') + comp.content;
    }
    if (comp.data && comp.data.content) {
      text += (text ? '\n' : '') + comp.data.content;
    }
    if (comp.components && Array.isArray(comp.components)) {
      const subText = extractComponentText(comp.components);
      if (subText) {
        text += (text ? '\n' : '') + subText;
      }
    }
  }
  return text;
}
const emojiFallbacks = {
  'iconweathernormalday': '☀️',
  'iconweathernormalnight': '🌙',
  'iconweatherrainyday': '🌧️',
  'iconweatherrainynight': '🌧️',
  'iconweathermeteornight': '🌠',
  'iconweathersnowyday': '❄️',
  'iconweathersnowynight': '❄️',
  'iconweathernormalsunrise': '🌅',
  'iconweathernormalsunset': '🌇',
  'iconweatherthunderstormday': '⛈️',
  'iconweatherthunderstormnight': '⛈️',
  'iconweathereclipse': '🌑',
  'iconweatherwindy': '💨',
  'iconweatherfoggy': '🌫️',
  'coin': '🪙',
  'money': '🪙',
  'xu': '🪙',
  'gem': '💎',
  'kimcuong': '💎',
  'iconfarmcoin': '🪙',
  'icongem': '💎',
  'apple': '🍎',
  'tao': '🍎',
  'mangcau': '🍈',
  'duahau': '🍉',
  'watermelon': '🍉',
  'xoai': '🥭',
  'mango': '🥭',
  'dautay': '🍓',
  'strawberry': '🍓',
  'anhdao': '🍒',
  'cherry': '🍒',
  'nho': '🍇',
  'grape': '🍇',
  'cachua': '🍅',
  'tomato': '🍅',
  'ot': '🌶️',
  'chili': '🌶️',
  'ngo': '🌽',
  'corn': '🌽',
  'bap': '🌽',
  'xuongrong': '🌵',
  'cactus': '🌵',
  'hoaloaken': '🪻',
  'lily': '🪻',
  'camtucau': '🌸',
  'hydrangea': '🌸',
  'khe': '🌟',
  'starfruit': '🌟',
  'carambola': '🌟',
  'dudu': '🥭',
  'papaya': '🥭',
  'sunflower': '🌻',
  'rose': '🌹',
  'tulip': '🌷',
  'carrot': '🥕',
  'potato': '🥔',
  'pumpkin': '🎃',
  'cucumber': '🥒',
  'cabbage': '🥬',
  'voitoc': '🚰',
  'voitau': '🚰',
  'voitot': '🚰',
  'voitro': '🚰',
  'sprinkler': '🚰',
  'wateringcan': '🚰',
  'fertilizer': '🪱',
  'npcfurniture': '🛋️',
  'tool': '👩‍🔧',
  'furniture': '🛋️',
  'scarecrowbox': '📦',
  'trashcanbox': '📦',
  'picnicbox': '📦',
  'adventurerguildchest': '📦',
  'woodchest': '📦',
  'steelchest': '📦',
  'goldchest': '📦',
  'mysteriousbox': '📦',
  'boxiconouthousepicnic': '🧺',
  'boxiconouthouseexplorer': '📦',
  'boxiconouthousescarecrow': '📦',
  'boxiconouthousetrashcan': '🗑️',
  'hop': '📦',
  'ruong': '📦',
  'box': '📦',
  'chest': '📦'
};
// Parse "<:name:id>" hoặc "<a:name:id>" → { name, id, animated }
function parseEmojiTag(tag) {
  if (!tag || typeof tag !== 'string') return null;
  const match = tag.match(/^<(a?):([^:]+):(\d+)>$/);
  if (!match) return null;
  return { animated: match[1] === 'a', name: match[2], id: match[3] };
}
// Lấy emoji object cho seedOptions từ emojis.json
function seedEmoji(key) {
  return parseEmojiTag(emojiConfig.emojis && emojiConfig.emojis[key]) || undefined;
}
function getFallbackEmoji(name) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (emojiFallbacks[normalized]) {
    return emojiFallbacks[normalized];
  }
  for (const [key, val] of Object.entries(emojiFallbacks)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return val;
    }
  }
  if (normalized.includes('weather')) return '🌦️';
  if (normalized.includes('seed') || normalized.includes('hat')) return '🌱';
  if (normalized.includes('shop') || normalized.includes('cua_hang')) return '🏪';
  return null;
}
function mapCustomEmojis(text, sourceMessage) {
  if (typeof text !== 'string') return text;
  const sourceGuildId = sourceMessage && sourceMessage.guild ? sourceMessage.guild.id : null;
  return text.replace(/<(a?):([a-zA-Z0-9_~]+):([0-9]+)>/g, (match, animated, name, id) => {
    if (emojiConfig.emojis && emojiConfig.emojis[name]) {
      const configuredEmoji = emojiConfig.emojis[name];
      if (configuredEmoji && !configuredEmoji.includes('ĐIỀN_ID_EMOJI_CỦA_BẠN_VÀO_ĐÂY')) {
        return configuredEmoji;
      }
    }
    const targetEmoji = botClient.emojis.cache.find(e => e.name === name && e.guild.id !== sourceGuildId);
    if (targetEmoji) {
      return `<${targetEmoji.animated ? 'a' : ''}:${targetEmoji.name}:${targetEmoji.id}>`;
    }
    const fallback = getFallbackEmoji(name);
    if (fallback) {
      return fallback;
    }
    return match;
  });
}
function getEndTimeStr(startTimeStr, minutes = 5) {
  const [hh, mm] = startTimeStr.split(':').map(Number);
  if (isNaN(hh) || isNaN(mm)) return startTimeStr;
  const totalMins = hh * 60 + mm + minutes;
  const endHh = Math.floor(totalMins / 60) % 24;
  const endMm = totalMins % 60;
  return `${endHh.toString().padStart(2, '0')}:${endMm.toString().padStart(2, '0')}`;
}
function formatToVietnameseTime(timeStr) {
  const [hh, mm] = timeStr.split(':').map(Number);
  if (isNaN(hh) || isNaN(mm)) return timeStr;
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}
function formatWeatherEmbed(originalEmbed, defaultRoleName, channelType) {
  if (defaultRoleName !== 'Thời Tiết') return null;
  const titleText = originalEmbed.title || '';
  const descText = originalEmbed.description || '';
  const combined = `${titleText}\n${descText}`;
  const lowerText = combined.toLowerCase();
  const rules = [
    {
      keys: ['cực quang', 'eclipse'],
      emojiKey: 'icon_weather_Eclipse',
      fallbackEmoji: '<:cucquang:1523873288969785394>',
      weatherName: 'Cực Quang',
      variantName: 'Cực Quang'
    },
    {
      keys: ['ánh trăng', 'moonlight'],
      emojiKey: 'anhtrang',
      fallbackEmoji: '<:anhtrang:1523873368829595710>',
      weatherName: 'Ánh Trăng',
      variantName: 'Ánh Trăng'
    },
    {
      keys: ['mưa', 'rainy', 'rain', 'ẩm ướt'],
      emojiKey: 'icon_weather_Rainy_Day',
      fallbackEmoji: '<:mua:1523873439968919652>',
      weatherName: 'Mưa',
      variantName: 'Ẩm Ướt'
    },
    {
      keys: ['bão', 'thunderstorm', 'nhiễm điện'],
      emojiKey: 'icon_weather_ThunderStorm_Day',
      fallbackEmoji: '<:bao:1523873558143565886>',
      weatherName: 'Bão',
      variantName: 'Nhiễm Điện'
    },
    {
      keys: ['gió cát', 'sandstorm', 'cát'],
      emojiKey: 'sandstorm',
      fallbackEmoji: '<:giocat:1523873722182664304>',
      weatherName: 'Gió Cát',
      variantName: 'Cát'
    },
    {
      keys: ['gió xuân', 'spring wind', 'spring breeze', 'bướm'],
      emojiKey: 'spring_wind',
      fallbackEmoji: '<:gioxuan:1523874877088469163>',
      weatherName: 'Gió Xuân',
      variantName: 'Bướm'
    },
    {
      keys: ['gió', 'windy', 'wind'],
      emojiKey: 'icon_weather_Windy',
      fallbackEmoji: '<:gio:1523873647842955414>',
      weatherName: 'Gió',
      variantName: 'Gió'
    },
    {
      keys: ['sương mù', 'foggy', 'fog'],
      emojiKey: 'icon_weather_Foggy',
      fallbackEmoji: '<:suongmu:1523873790008889414>',
      weatherName: 'Sương Mù',
      variantName: 'Ẩm Ướt'
    },
    {
      keys: ['sương sớm', 'mist', 'dew', 'sương'],
      emojiKey: 'mist',
      fallbackEmoji: '<:suongsom:1523874606878953623>',
      weatherName: 'Sương Sớm',
      variantName: 'Sương'
    },
    {
      keys: ['nắng nóng', 'heatwave', 'khô'],
      emojiKey: 'heatwave',
      fallbackEmoji: '<:nangnong:1523874825720827904>',
      weatherName: 'Nắng Nóng',
      variantName: 'Khô'
    },
    {
      keys: ['sóng điện từ', 'electromagnetic', 'digital', 'tê điện'],
      emojiKey: 'electromagnetic',
      fallbackEmoji: '<:songdientu:1523874917890789497>',
      weatherName: 'Sóng Điện Từ',
      variantName: 'Tê Điện'
    }
  ];

  let matchedRule = null;
  for (const rule of rules) {
    let matched = false;
    for (const key of rule.keys) {
      if (lowerText.includes(key)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      matchedRule = rule;
      break;
    }
  }

  if (channelType === 'weather') {
    // Luôn dùng giờ thực của máy chủ theo múi giờ Việt Nam (UTC+7)
    const vnFormatter = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const startTime = vnFormatter.format(new Date());

    let embedTitle = '';
    let embedDesc = '';

    if (matchedRule) {
      let emoji = matchedRule.fallbackEmoji;
      if (emojiConfig.emojis && emojiConfig.emojis[matchedRule.emojiKey]) {
        const val = emojiConfig.emojis[matchedRule.emojiKey];
        if (val && !val.includes('ĐIỀN_ID_EMOJI')) {
          emoji = val;
        }
      }
      embedTitle = `**${emoji} ${matchedRule.weatherName} đang xuất hiện**`;
      embedDesc = `-# Nông sản biến thể: ${matchedRule.variantName}`;
      embedDesc += `\n\n**Thời gian︱${startTime} ~ ${getEndTimeStr(startTime)}**`;
    } else {
      let cleanTitle = titleText || combined.split('\n')[0] || 'Thông báo thời tiết';
      cleanTitle = cleanTitle.replace(/\[\d{1,2}:\d{2}\]|\b\d{1,2}:\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
      embedTitle = `**${cleanTitle}**`;
      embedDesc = `\n**Thời gian︱${startTime}**`;
    }
    
    return {
      title: embedTitle,
      description: embedDesc,
      color: 0xFFD700,
      thumbnail: { url: 'https://media.discordapp.net/stickers/1532063123664539819.gif?size=160' }
    };
  }

  if (matchedRule) {
    let emoji = matchedRule.fallbackEmoji;
    if (emojiConfig.emojis && emojiConfig.emojis[matchedRule.emojiKey]) {
      const val = emojiConfig.emojis[matchedRule.emojiKey];
      if (val && !val.includes('ĐIỀN_ID_EMOJI')) {
        emoji = val;
      }
    }
    let description = `${emoji} ${matchedRule.weatherName} đang xuất hiện\n-# Nông sản biến thể: ${matchedRule.variantName}`;
    const timeMatch = combined.match(/(Thời gian|Time):\s*([^\n]+)/i);
    if (timeMatch) {
      description += `\n${timeMatch[0]}`;
    }
    return {
      description: description,
      color: 0xFFD700
    };
  }
  return null;
}
function formatShopEmbedIfMatches(rawText, category, botAvatarUrl, channelType) {
  if (!rawText) return null;
  const cleanRawText = rawText.replace(/<@&?\d+>|<#\d+>/g, '').trim();
  const match = cleanRawText.match(/\[(\d{1,2}:\d{2})\]\s*(.*)$/s);
  if (!match) return null;
  let startTimeStr = match[1];
  // Kênh báo-nông-cụ: dùng giờ Việt Nam hiện tại làm thời điểm bắt đầu
  if (channelType === 'tools') {
    const vnFormatter = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    startTimeStr = vnFormatter.format(new Date()).replace('.', ':').replace(/[^\d:]/g, '').slice(0, 5);
  }
  const itemsPart = match[2].trim();
  const rawItems = itemsPart.split(/\s*-\s*/);
  const formattedItems = [];
  for (const item of rawItems) {
    const trimmedItem = item.trim();
    if (!trimmedItem) continue;
    const cleanItem = trimmedItem
      .replace(/<a?:[a-zA-Z0-9_~]+:[0-9]+>\s*/g, '')
      .replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, '')
      .replace(/^[#>\s-]+|[#>\s-]+$/g, '')
      .trim();
    if (!cleanItem) continue;
    const qtyMatch = cleanItem.match(/^(.*?)\s*x\s*(\d+)$/);
    if (qtyMatch) {
      const name = qtyMatch[1].trim();
      const qty = qtyMatch[2].trim();
      const itemWithEmoji = insertItemEmojis(name);
      const emojiMatch = itemWithEmoji.match(/^(\S+)\s+(.*)$/);
      if (emojiMatch) {
        const emoji = emojiMatch[1];
        const nameOnly = emojiMatch[2];
        formattedItems.push(`${emoji} **${nameOnly}** x${qty}`);
      } else {
        formattedItems.push(`**${itemWithEmoji}** x${qty}`);
      }
    } else {
      const itemWithEmoji = insertItemEmojis(cleanItem);
      const emojiMatch = itemWithEmoji.match(/^(\S+)\s+(.*)$/);
      if (emojiMatch) {
        const emoji = emojiMatch[1];
        const nameOnly = emojiMatch[2];
        formattedItems.push(`${emoji} **${nameOnly}**`);
      } else {
        formattedItems.push(`**${itemWithEmoji}**`);
      }
    }
  }
  if (formattedItems.length === 0) return null;
  // Kênh báo-nông-cụ dùng 30 phút, các kênh khác dùng 5 phút
  const endMins = channelType === 'tools' ? 30 : 5;
  const endTimeStr = getEndTimeStr(startTimeStr, endMins);
  const startTimeFormatted = formatToVietnameseTime(startTimeStr);
  const endTimeFormatted = formatToVietnameseTime(endTimeStr);
  let npcEmoji = '🏪';
  let authorName = 'Thông báo cửa hàng';
  let embedColor = 0x2b2d31;
  if (category === 'Hạt Giống') {
    npcEmoji = (emojiConfig.emojis && emojiConfig.emojis['npc_seedshop']) ? emojiConfig.emojis['npc_seedshop'] : '<:hatgiong:1523885555170017312>';
    authorName = 'Hạt giống đang được bán';
    embedColor = 0x2ecc71;
  } else if (category === 'Nông Cụ') {
    npcEmoji = (emojiConfig.emojis && emojiConfig.emojis['npc_toolshop']) ? emojiConfig.emojis['npc_toolshop'] : '<:congcu:1523885700737400892>';
    authorName = 'Nông cụ đang được bán';
    embedColor = 0x3498db;
  }
  let authorIconUrl = null;
  const emojiIdMatch = npcEmoji.match(/:([0-9]+)>$/);
  if (emojiIdMatch) {
    authorIconUrl = `https://cdn.discordapp.com/emojis/${emojiIdMatch[1]}.png`;
  }
  if (channelType === 'seeds' && category === 'Hạt Giống') {
    const description = `### ${npcEmoji} ${authorName}\n` + formattedItems.join('\n') + `\n\n**Thời gian bán︱${startTimeFormatted} ~ ${endTimeFormatted}**`;
    return {
      description: description,
      color: embedColor
    };
  }
  if (channelType === 'tools' && category === 'Nông Cụ') {
    const description = `### ${npcEmoji} ${authorName}\n` + formattedItems.join('\n') + `\n\n**Thời gian bán︱${startTimeFormatted} ~ ${endTimeFormatted}**`;
    return {
      description: description,
      color: embedColor
    };
  }
  const description = formattedItems.join('\n') + `\n\n**Thời gian bán︱${startTimeFormatted} ~ ${endTimeFormatted}**`;
  return {
    author: {
      name: authorName,
      icon_url: authorIconUrl || undefined
    },
    description: description,
    color: embedColor
  };
}
function insertItemEmojis(text) {
  if (typeof text !== 'string') return text;
  let result = text;
  const defs = Object.values(roleDefinitions)
    .filter(d => d.key && !d.key.startsWith('main_') && d.name)
    .sort((a, b) => b.name.length - a.name.length);
  for (const def of defs) {
    const name = def.name;
    const key = def.key;
    let emoji = '';
    if (emojiConfig.emojis && emojiConfig.emojis[key]) {
      const val = emojiConfig.emojis[key];
      if (val && !val.includes('ĐIỀN_ID_EMOJI_CỦA_BẠN_VÀO_ĐÂY')) {
        emoji = val;
      }
    }
    if (!emoji) {
      emoji = getFallbackEmoji(key) || '';
    }
    if (emoji) {
      const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`((?:<a?:[a-zA-Z0-9_~]+:[0-9]+>|[\\u2700-\\u27BF]|[\\uE000-\\uF8FF]|\\uD83C[\\uDC00-\\uDFFF]|\\uD83D[\\uDC00-\\uDFFF]|[\\u2011-\\u26FF]|\\uD83E[\\uDD00-\\uDFFF])\\s*)?(${escapedName})`, 'g');
      result = result.replace(regex, (match, prefix, matchedName) => {
        if (prefix) {
          return match;
        }
        return `${emoji} ${matchedName}`;
      });
    }
  }
  return result;
}
async function getTargetGuild(mapping, sourceGuildId) {
  if (config.targetGuildId) {
    const guild = botClient.guilds.cache.get(config.targetGuildId);
    if (guild) return guild;
  }
  if (mapping.targetChannelId) {
    try {
      const chan = await botClient.channels.fetch(mapping.targetChannelId);
      if (chan && chan.guild) return chan.guild;
    } catch (e) { }
  }
  return botClient.guilds.cache.first();
}
function deduplicateLines(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const seenLines = new Set();
  const resultLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      resultLines.push('');
      continue;
    }
    const normalized = trimmed
      .toLowerCase()
      .replace(/<a?:[a-zA-Z0-9_~]+:[0-9]+>/g, '')
      .replace(/:[a-zA-Z0-9_~]+:/g, '')
      .replace(/[\s\p{P}]/gu, '');
    const finalKey = normalized || trimmed;
    let isDuplicate = false;
    for (const seen of seenLines) {
      if (seen === finalKey || seen.includes(finalKey) || finalKey.includes(seen)) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      seenLines.add(finalKey);
      resultLines.push(trimmed);
    }
  }
  return resultLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function formatEmbedTitle(title, sourceMessage) {
  if (!title) return null;
  let cleaned = title
    .replace(/^[#\s>*_-]+/g, '')
    .replace(/[*_]+$/g, '')
    .trim();
  const lower = cleaned.toLowerCase();
  if ((lower.includes('cửa hàng nông cụ') || lower.includes('nông cụ')) && (lower.includes('làm mới') || lower.includes('đã được làm mới'))) {
    return '<:Toolshop:1523883603484872905> Cửa hàng nông cụ đã được làm mới';
  }
  if (lower.includes('đơn hàng') && (lower.includes('làm mới') || lower.includes('đã được làm mới'))) {
    return '<:Order:1523883533326749786> Đơn hàng đã được làm mới';
  }
  if ((lower.includes('cửa hàng nội thất') || lower.includes('nội thất')) && (lower.includes('làm mới') || lower.includes('đã được làm mới'))) {
    return '<:cuahangnoithat:1532334875137413230> Cửa hàng nội thất đã được làm mới';
  }
  return insertItemEmojis(mapCustomEmojis(cleaned, sourceMessage));
}
function formatFallbackDescription(text) {
  if (!text) return text;
  return text.replace(/\b(\d{1,2}:\d{2}(?:\s*(?:AM|PM|CH|SA))?)\b/gi, '`$1`');
}
function getAllMessageText(message) {
  let texts = [];
  if (message.content) {
    texts.push(message.content);
  }
  if (message.components && message.components.length > 0) {
    texts.push(extractComponentText(message.components));
  }
  if (message.embeds && message.embeds.length > 0) {
    for (const embed of message.embeds) {
      if (embed.title) texts.push(embed.title);
      if (embed.description) texts.push(embed.description);
      if (embed.author && embed.author.name) texts.push(embed.author.name);
      if (embed.footer && embed.footer.text) texts.push(embed.footer.text);
      if (embed.fields && embed.fields.length > 0) {
        for (const field of embed.fields) {
          if (field.name) texts.push(field.name);
          if (field.value) texts.push(field.value);
        }
      }
    }
  }
  return texts.join('\n');
}
async function formatPlayTogetherNotification(message, targetGuild) {
  const rawContent = getAllMessageText(message);
  const lowerContent = rawContent.toLowerCase();
  if (lowerContent.includes('đã xóa một tin nhắn') || lowerContent.includes('đã chỉnh sửa') || lowerContent.includes('chi đã xóa một tin nhắn')) {
    return {
      content: rawContent,
      embeds: []
    };
  }
  let defaultRoleName = null;
  const channelId = message.channel.id;
  if (channelId === '1427881650234195988' || lowerContent.includes('hạt giống') || lowerContent.includes('seedshop')) {
    defaultRoleName = 'Hạt Giống';
  } else if (channelId === '1428368453760319508' || lowerContent.includes('thời tiết') || lowerContent.includes('weather')) {
    defaultRoleName = 'Thời Tiết';
  } else if (channelId === '1453016064807010497' || lowerContent.includes('nông cụ') || lowerContent.includes('toolshop')) {
    defaultRoleName = 'Nông Cụ';
  } else if (channelId === '1489537078822834376' || lowerContent.includes('làm mới') || lowerContent.includes('refresh') || lowerContent.includes('đơn hàng') || lowerContent.includes('order')) {
    defaultRoleName = 'Thời Gian Làm Mới';
  }
  const rolesToPing = [];
  if (targetGuild) {
    try { await targetGuild.roles.fetch(); } catch (e) { }
    const pingedRoleIds = new Set();
    const addRoleToPing = (roleIdOrName) => {
      if (!roleIdOrName) return;
      if (/^\d+$/.test(roleIdOrName)) {
        if (!pingedRoleIds.has(roleIdOrName)) {
          pingedRoleIds.add(roleIdOrName);
          rolesToPing.push(`<@&${roleIdOrName}>`);
        }
      } else {
        let nameToSearch = roleIdOrName.toLowerCase();
        let targetRole = targetGuild.roles.cache.find(r => r.name.toLowerCase() === nameToSearch);
        if (targetRole) {
          if (!pingedRoleIds.has(targetRole.id)) {
            pingedRoleIds.add(targetRole.id);
            rolesToPing.push(`<@&${targetRole.id}>`);
          }
        } else {
          log.warn(`Không thể tìm thấy vai trò "${roleIdOrName}" (hoặc các tên gọi thay thế) trên máy chủ "${targetGuild.name}".`);
        }
      }
    };
    if (message.mentions && message.mentions.roles && message.mentions.roles.size > 0) {
      message.mentions.roles.forEach(role => {
        const roleNameLower = role.name.toLowerCase();
        let matchedRoleId = null;
        if (emojiConfig.roles) {
          const matchedKey = Object.keys(emojiConfig.roles).find(k => k.toLowerCase() === roleNameLower);
          if (matchedKey) {
            const val = emojiConfig.roles[matchedKey];
            if (val && !val.includes('ĐIỀN_ID_ROLE_CỦA_BẠN_VÀO_ĐÂY')) {
              matchedRoleId = val;
            }
          }
        }
        if (matchedRoleId) {
          addRoleToPing(matchedRoleId);
        } else {
          addRoleToPing(role.name);
        }
      });
    }
    if (defaultRoleName === 'Hạt Giống') {
      const plantNameMap = {
        'anh đào': 'cherry',
        'cherry': 'cherry',
        'xương rồng': 'cactus',
        'cactus': 'cactus',
        'đu đủ': 'papaya',
        'papaya': 'papaya',
        'dudu': 'papaya',
        'dưa hấu': 'watermelon',
        'watermelon': 'watermelon',
        'duahau': 'watermelon',
        'xoài': 'mango',
        'mango': 'mango',
        'xoai': 'mango',
        'nho': 'grape',
        'grape': 'grape',
        'hoa loa kèn': 'lily',
        'lily': 'lily',
        'hoaloaken': 'lily',
        'cẩm tú cầu': 'hydrangea',
        'hydrangea': 'hydrangea',
        'camtucau': 'hydrangea',
        'khế': 'starfruit',
        'starfruit': 'starfruit',
        'carambola': 'starfruit',
        'khe': 'starfruit',
        'mãng cầu': 'mangcau',
        'mangcau': 'mangcau',
        'táo': 'apple',
        'apple': 'apple',
        'tao': 'apple',
        'bí ngô': 'pumpkin',
        'pumpkin': 'pumpkin',
        'bingo': 'pumpkin',
        'dừa': 'coconut',
        'coconut': 'coconut',
        'dua': 'coconut',
        'đậu': 'bean',
        'bean': 'bean',
        'dau': 'bean',
        'táo đường': 'custard_apple',
        'custard_apple': 'custard_apple',
        'tao duong': 'custard_apple',
        'hoa hồng': 'rose',
        'rose': 'rose',
        'hoa hong': 'rose'
      };
      for (const [plantName, cropKey] of Object.entries(plantNameMap)) {
        if (lowerContent.includes(plantName)) {
          let cropRoleId = null;
          if (emojiConfig.roles && emojiConfig.roles[cropKey]) {
            const val = emojiConfig.roles[cropKey];
            if (val && !val.includes('ĐIỀN_ID_ROLE_') && !val.includes('ĐIỀN_ID_ROLE_CỦA_BẠN_VÀO_ĐÂY')) {
              cropRoleId = val;
            }
          }
          if (cropRoleId) {
            addRoleToPing(cropRoleId);
          } else {
            const def = roleDefinitions[cropKey];
            if (def && def.name) {
              addRoleToPing(def.name);
            }
          }
        }
      }
    }
    if (defaultRoleName === 'Thời Gian Làm Mới') {
      const refreshNameMap = {
        'đơn hàng': 'refresh_order',
        'order': 'refresh_order',
        'nội thất': 'refresh_furniture',
        'furniture': 'refresh_furniture',
        'nông cụ': 'refresh_toolshop',
        'toolshop': 'refresh_toolshop'
      };
      for (const [refName, refKey] of Object.entries(refreshNameMap)) {
        if (lowerContent.includes(refName)) {
          let refRoleId = null;
          if (emojiConfig.roles && emojiConfig.roles[refKey]) {
            const val = emojiConfig.roles[refKey];
            if (val && !val.includes('ĐIỀN_ID_ROLE_') && !val.includes('ĐIỀN_ID_ROLE_CỦA_BẠN_VÀO_ĐÂY')) {
              refRoleId = val;
            }
          }
          if (refRoleId) {
            addRoleToPing(refRoleId);
          } else {
            const def = roleDefinitions[refKey];
            if (def && def.name) {
              addRoleToPing(def.name);
            }
          }
        }
      }
    }
    if (defaultRoleName === 'Thời Tiết') {
      if (message.mentions && message.mentions.roles && message.mentions.roles.size > 0) {
        const sourceRoleNameToKey = {
          'moonlight': 'moonlight',
          'rain': 'rainy',
          'thunderstorm': 'thunderstorm',
          'aurora': 'eclipse',
          'wind': 'windy',
          'fog': 'foggy',
          'sandstorm': 'sandstorm',
          'heatwave': 'heatwave',
          'dew': 'mist',
          'spring breeze': 'spring_wind',
          'digital': 'electromagnetic'
        };
        message.mentions.roles.forEach(role => {
          const nameLower = role.name.toLowerCase();
          for (const [sName, weaKey] of Object.entries(sourceRoleNameToKey)) {
            if (nameLower.includes(sName)) {
              let weaRoleId = null;
              if (emojiConfig.roles && emojiConfig.roles[weaKey]) {
                const val = emojiConfig.roles[weaKey];
                if (val && !val.includes('ĐIỀN_ID_ROLE_') && !val.includes('ĐIỀN_ID_ROLE_CỦA_BẠN_VÀO_ĐÂY')) {
                  weaRoleId = val;
                }
              }
              if (weaRoleId) {
                addRoleToPing(weaRoleId);
              } else {
                const def = roleDefinitions[weaKey];
                if (def && def.name) {
                  addRoleToPing(def.name);
                }
              }
            }
          }
        });
      }
      const weatherNameMap = {
        'trời sáng': 'normal_day',
        'sáng': 'normal_day',
        'normal day': 'normal_day',
        'ánh trăng': 'moonlight',
        'moonlight': 'moonlight',
        'tối': 'normal_night',
        'trời tối': 'normal_night',
        'màn đêm': 'normal_night',
        'trời đêm': 'normal_night',
        'màn đêm buông xuống': 'normal_night',
        'normal night': 'normal_night',
        'mưa': 'rainy',
        'rain': 'rainy',
        'rainy': 'rainy',
        'ẩm ướt': ['rainy', 'foggy'],
        'bão': 'thunderstorm',
        'nhiễm điện': 'thunderstorm',
        'thunderstorm': 'thunderstorm',
        'cực quang': 'eclipse',
        'aurora': 'eclipse',
        'eclipse': 'eclipse',
        'gió': 'windy',
        'wind': 'windy',
        'windy': 'windy',
        'gió cát': 'sandstorm',
        'cát': 'sandstorm',
        'sandstorm': 'sandstorm',
        'sương mù': 'foggy',
        'fog': 'foggy',
        'foggy': 'foggy',
        'sương sớm': 'mist',
        'sương': 'mist',
        'dew': 'mist',
        'mist': 'mist',
        'nắng nóng': 'heatwave',
        'khô': 'heatwave',
        'heatwave': 'heatwave',
        'gió xuân': 'spring_wind',
        'bướm': 'spring_wind',
        'spring breeze': 'spring_wind',
        'spring wind': 'spring_wind',
        'sóng điện từ': 'electromagnetic',
        'tê điện': 'electromagnetic',
        'digital': 'electromagnetic',
        'electromagnetic': 'electromagnetic'
      };
      for (const [weaName, weaKeys] of Object.entries(weatherNameMap)) {
        if (lowerContent.includes(weaName)) {
          const keys = Array.isArray(weaKeys) ? weaKeys : [weaKeys];
          for (const weaKey of keys) {
            let weaRoleId = null;
            if (emojiConfig.roles && emojiConfig.roles[weaKey]) {
              const val = emojiConfig.roles[weaKey];
              if (val && !val.includes('ĐIỀN_ID_ROLE_') && !val.includes('ĐIỀN_ID_ROLE_CỦA_BẠN_VÀO_ĐÂY')) {
                weaRoleId = val;
              }
            }
            if (weaRoleId) {
              addRoleToPing(weaRoleId);
            } else {
              const def = roleDefinitions[weaKey];
              if (def && def.name) {
                addRoleToPing(def.name);
              }
            }
          }
        }
      }
    }
    if (defaultRoleName === 'Nông Cụ') {
      const toolNameMap = {
        'vòi tưới thường': 'normal_watering_can',
        'vòi thường': 'normal_watering_can',
        'normal watering': 'normal_watering_can',
        'vòi tưới cao cấp': 'advanced_watering_can',
        'vòi cao cấp': 'advanced_watering_can',
        'advanced watering': 'advanced_watering_can',
        'vòi tưới siêu cao cấp': 'expert_watering_can',
        'vòi siêu cấp': 'expert_watering_can',
        'expert watering': 'expert_watering_can'
      };
      for (const [toolName, toolKey] of Object.entries(toolNameMap)) {
        if (lowerContent.includes(toolName)) {
          let toolRoleId = null;
          if (emojiConfig.roles && emojiConfig.roles[toolKey]) {
            const val = emojiConfig.roles[toolKey];
            if (val && !val.includes('ĐIỀN_ID_ROLE_') && !val.includes('ĐIỀN_ID_ROLE_CỦA_BẠN_VÀO_ĐÂY')) {
              toolRoleId = val;
            }
          }
          if (toolRoleId) {
            addRoleToPing(toolRoleId);
          } else {
            const def = roleDefinitions[toolKey];
            if (def && def.name) {
              addRoleToPing(def.name);
            }
          }
        }
      }
    }
  }
  const botAvatarUrl = botClient.user ? botClient.user.displayAvatarURL() : null;
  const mapping = config.channelMappings.find(m => m.sourceChannelId === message.channel.id);
  const channelType = mapping ? mapping.type : null;
  const shopEmbed = formatShopEmbedIfMatches(rawContent, defaultRoleName, botAvatarUrl, channelType);
  if (shopEmbed) {
    return {
      content: rolesToPing.length > 0 ? rolesToPing.join(' ') : null,
      embeds: [shopEmbed]
    };
  }
  if (message.embeds && message.embeds.length > 0) {
    const targetEmbeds = message.embeds.map(originalEmbed => {
      if (defaultRoleName === 'Thời Tiết') {
        const customWeather = formatWeatherEmbed(originalEmbed, defaultRoleName, channelType);
        if (customWeather) {
          return customWeather;
        }
      }
      const targetEmbed = {
        title: originalEmbed.title ? formatEmbedTitle(originalEmbed.title, message) : null,
        description: originalEmbed.description ? formatFallbackDescription(insertItemEmojis(mapCustomEmojis(originalEmbed.description, message))) : null,
        url: originalEmbed.url || null,
        color: originalEmbed.color || 0x2b2d31
      };
      if (originalEmbed.author) {
        targetEmbed.author = {
          name: originalEmbed.author.name ? insertItemEmojis(mapCustomEmojis(originalEmbed.author.name, message)) : null,
          icon_url: originalEmbed.author.iconURL || originalEmbed.author.icon_url || null,
          url: originalEmbed.author.url || null
        };
      }
      if (originalEmbed.thumbnail) {
        targetEmbed.thumbnail = {
          url: originalEmbed.thumbnail.url || null
        };
      }
      if (originalEmbed.image) {
        targetEmbed.image = {
          url: originalEmbed.image.url || null
        };
      }
      if (originalEmbed.footer) {
        targetEmbed.footer = {
          text: originalEmbed.footer.text ? insertItemEmojis(mapCustomEmojis(originalEmbed.footer.text, message)) : null,
          icon_url: originalEmbed.footer.iconURL || originalEmbed.footer.icon_url || null
        };
      }
      if (originalEmbed.fields && originalEmbed.fields.length > 0) {
        targetEmbed.fields = originalEmbed.fields.map(f => ({
          name: f.name ? insertItemEmojis(mapCustomEmojis(f.name, message)) : '',
          value: f.value ? insertItemEmojis(mapCustomEmojis(f.value, message)) : '',
          inline: !!f.inline
        }));
      }
      for (const key of Object.keys(targetEmbed)) {
        if (targetEmbed[key] === null) {
          delete targetEmbed[key];
        }
      }
      return targetEmbed;
    });
    return {
      content: rolesToPing.length > 0 ? rolesToPing.join(' ') : null,
      embeds: targetEmbeds
    };
  }
  let cleanText = message.content || '';
  if (!cleanText && message.components && message.components.length > 0) {
    cleanText = extractComponentText(message.components);
  }
  cleanText = deduplicateLines(cleanText);
  cleanText = mapCustomEmojis(cleanText, message);
  if (message.mentions && message.mentions.roles) {
    message.mentions.roles.forEach(role => {
      const roleMentionRegex = new RegExp(`<@&${role.id}>`, 'g');
      cleanText = cleanText.replace(roleMentionRegex, '');
    });
  }
  let lines = cleanText.split('\n');
  lines = lines.filter(line => {
    const l = line.toLowerCase();
    if (l.includes('đang bán') || l.includes('làm mới') || l.includes('đã được làm mới') || l.includes('thời gian bán')) {
      return true;
    }
    if (l.includes('http') || l.includes('link') || l.includes('ủng hộ') || l.includes('donat') || l.includes('hỗ trợ')) {
      return false;
    }
    return true;
  });
  lines = lines
    .map(line => line.replace(/^[#>\s*-]+/g, '').trim())
    .filter(line => {
      if (!line) return false;
      const stripped = line.replace(/[#>\s\-\*_|]+/g, '');
      if (stripped === '') return false;
      return true;
    });
  let title = 'CẬP NHẬT PLAY TOGETHER';
  let description = '';
  if (lines.length > 0) {
    title = formatEmbedTitle(lines[0], message);
    if (title.length > 100) title = title.substring(0, 97) + '...';
    if (!title) title = 'Thông Báo Mới';
    description = lines.slice(1).join('\n').trim();
    description = formatFallbackDescription(insertItemEmojis(description));
  }
  let embedColor = 0x2b2d31;
  if (lowerContent.includes('làm mới') || lowerContent.includes('refresh') || lowerContent.includes('đã được làm mới')) {
    embedColor = 0x2b2d31;
  } else if (lowerContent.includes('thời tiết') || lowerContent.includes('mưa') || lowerContent.includes('bão') || lowerContent.includes('nắng') || lowerContent.includes('tuyết')) {
    embedColor = 0x3498db;
  } else if (lowerContent.includes('hạt giống') || lowerContent.includes('trái cây') || lowerContent.includes('nông cụ') || lowerContent.includes('cây')) {
    embedColor = 0x2ecc71;
  } else if (lowerContent.includes('nội thất')) {
    embedColor = 0xe91e63;
  } else if (lowerContent.includes('thời gian')) {
    embedColor = 0xf1c40f;
  }
  let embed = {
    title: title,
    description: description || '_Không có mô tả chi tiết_',
    color: embedColor
  };
  if (defaultRoleName === 'Thời Tiết') {
    const customWeather = formatWeatherEmbed(embed, defaultRoleName, channelType);
    if (customWeather) {
      embed = customWeather;
    }
  }
  return {
    content: rolesToPing.length > 0 ? rolesToPing.join(' ') : null,
    embeds: [embed]
  };
}
const roleDefinitions = {
  'cactus': { name: 'Xương Rồng', key: 'cactus' },
  'apple': { name: 'Táo', key: 'apple' },
  'grape': { name: 'Nho', key: 'grape' },
  'pumpkin': { name: 'Bí Ngô', key: 'pumpkin' },
  'watermelon': { name: 'Dưa Hấu', key: 'watermelon' },
  'cherry': { name: 'Anh Đào', key: 'cherry' },
  'papaya': { name: 'Đu Đủ', key: 'papaya' },
  'mango': { name: 'Xoài', key: 'mango' },
  'lily': { name: 'Hoa Loa Kèn', key: 'lily' },
  'hydrangea': { name: 'Cẩm Tú Cầu', key: 'hydrangea' },
  'starfruit': { name: 'Khế', key: 'starfruit' },
  'mangcau': { name: 'Mãng Cầu', key: 'mangcau' },
  'coconut': { name: 'Dừa', key: 'coconut' },
  'bean': { name: 'Đậu', key: 'bean' },
  'custard_apple': { name: 'Táo Đường', key: 'custard_apple' },
  'rose': { name: 'Hoa Hồng', key: 'rose' },
  'normal_day': { name: 'Trời Sáng', key: 'normal_day' },
  'normal_night': { name: 'Trời Tối', key: 'normal_night' },
  'moonlight': { name: 'Ánh Trăng', key: 'moonlight' },
  'rainy': { name: 'Mưa', key: 'rainy' },
  'thunderstorm': { name: 'Bão', key: 'thunderstorm' },
  'eclipse': { name: 'Cực Quang', key: 'eclipse' },
  'windy': { name: 'Gió', key: 'windy' },
  'foggy': { name: 'Sương Mù', key: 'foggy' },
  'sandstorm': { name: 'Gió Cát', key: 'sandstorm' },
  'mist': { name: 'Sương Sớm', key: 'mist' },
  'heatwave': { name: 'Nắng Nóng', key: 'heatwave' },
  'spring_wind': { name: 'Gió Xuân', key: 'spring_wind' },
  'electromagnetic': { name: 'Sóng Điện Từ', key: 'electromagnetic' },
  'normal_watering_can': { name: 'Vòi Tưới Thường', key: 'normal_watering_can' },
  'advanced_watering_can': { name: 'Vòi Tưới Cao Cấp', key: 'advanced_watering_can' },
  'expert_watering_can': { name: 'Vòi Tưới Siêu Cao Cấp', key: 'expert_watering_can' },
  'refresh_order': { name: 'Đơn Hàng', key: 'refresh_order' },
  'refresh_furniture': { name: 'Cửa Hàng Nội Thất', key: 'refresh_furniture' },
  'refresh_toolshop': { name: 'Cửa Hàng Nông Cụ', key: 'refresh_toolshop' },
  'main_seed': { name: 'Hạt Giống', key: 'Hạt Giống' },
  'main_weather': { name: 'Thời Tiết', key: 'Thời Tiết' },
  'main_tool': { name: 'Nông Cụ', key: 'Nông Cụ' },
  'main_refresh': { name: 'Thời Gian Làm Mới', key: 'Thời Gian Làm Mới' }
};
const seedOptions = [
  // Emoji đọc từ emojis.json — chỉ cần sửa emojis.json để đổi emoji, không cần sửa file này
  { label: 'Xương Rồng',  value: 'cactus',        emoji: seedEmoji('cactus') },
  { label: 'Táo',          value: 'apple',          emoji: seedEmoji('apple') },
  { label: 'Nho',          value: 'grape',          emoji: seedEmoji('grape') },
  { label: 'Bí Ngô',       value: 'pumpkin',        emoji: seedEmoji('pumpkin') },
  { label: 'Dưa Hấu',     value: 'watermelon',     emoji: seedEmoji('watermelon') },
  { label: 'Dừa',          value: 'coconut',        emoji: seedEmoji('coconut') },
  { label: 'Xoài',         value: 'mango',          emoji: seedEmoji('mango') },
  { label: 'Đậu',          value: 'bean',           emoji: seedEmoji('bean') },
  { label: 'Khế',          value: 'starfruit',      emoji: seedEmoji('starfruit') },
  { label: 'Táo Đường',   value: 'custard_apple',  emoji: seedEmoji('custard_apple') },
  { label: 'Đu Đủ',       value: 'papaya',         emoji: seedEmoji('papaya') },
  { label: 'Mãng Cầu',    value: 'mangcau',        emoji: seedEmoji('mangcau') },
  { label: 'Anh Đào',     value: 'cherry',         emoji: seedEmoji('cherry') },
  { label: 'Cẩm Tú Cầu', value: 'hydrangea',      emoji: seedEmoji('hydrangea') },
  { label: 'Hoa Loa Kèn', value: 'lily',           emoji: seedEmoji('lily') },
  { label: 'Hoa Hồng',    value: 'rose',           emoji: seedEmoji('rose') },
];
// weatherOptions đọc emoji từ emojis.json — chỉ cần sửa emojis.json để thay emoji
const weatherOptions = [
  { label: 'Trời Sáng',     value: 'normal_day',     emoji: seedEmoji('normal_day') },
  { label: 'Trời Tối',      value: 'normal_night',   emoji: seedEmoji('normal_night') },
  { label: 'Ánh Trăng',    value: 'moonlight',      emoji: seedEmoji('moonlight') },
  { label: 'Mưa',           value: 'rainy',          emoji: seedEmoji('rainy') },
  { label: 'Bão',           value: 'thunderstorm',   emoji: seedEmoji('thunderstorm') },
  { label: 'Cực Quang',    value: 'eclipse',         emoji: seedEmoji('eclipse') },
  { label: 'Gió',           value: 'windy',          emoji: seedEmoji('windy') },
  { label: 'Sương Mù',     value: 'foggy',           emoji: seedEmoji('foggy') },
  { label: 'Gió Cát',      value: 'sandstorm',       emoji: seedEmoji('sandstorm') },
  { label: 'Sương Sớm',    value: 'mist',            emoji: seedEmoji('mist') },
  { label: 'Nắng Nóng',    value: 'heatwave',        emoji: seedEmoji('heatwave') },
];
const toolOptions = [
  { label: 'Vòi Tưới Thường', value: 'normal_watering_can', emoji: { id: '1532041549721108630', name: 'voi_xanh', animated: true } },
  { label: 'Vòi Tưới Cao Cấp', value: 'advanced_watering_can', emoji: { id: '1531990612734251090', name: 'voi_xanh', animated: true } },
  { label: 'Vòi Tưới Siêu Cao Cấp', value: 'expert_watering_can', emoji: { id: '1531990577728720996', name: 'voi_do', animated: true } }
];
const refreshOptions = [
  { label: 'Đơn Hàng',          value: 'refresh_order',     emoji: '<:Order:1523883533326749786>' },
  { label: 'Cửa Hàng Nội Thất', value: 'refresh_furniture', emoji: '<:cuahangnoithat:1532334875137413230>' },
  { label: 'Cửa Hàng Nông Cụ',  value: 'refresh_toolshop',  emoji: '<:Toolshop:1523883603484872905>' }
];
const mainOptions = [
  { label: 'Hạt Giống (Mọi hạt giống)', value: 'main_seed', emoji: '🌱' },
  { label: 'Thời Tiết (Mọi thời tiết)', value: 'main_weather', emoji: '🌦️' },
  { label: 'Nông Cụ (Mọi nông cụ)', value: 'main_tool', emoji: '🧰' },
  { label: 'Thời Gian Làm Mới', value: 'main_refresh', emoji: '🕒' }
];
function userHasRole(member, roleKey) {
  const def = roleDefinitions[roleKey];
  if (!def) return false;
  if (!emojiConfig.roles || !emojiConfig.roles[def.key]) return false;
  const roleId = emojiConfig.roles[def.key];
  if (!roleId || roleId.includes('ĐIỀN_ID_ROLE_') || roleId.includes('ĐIỀN_ID_ROLE_CỦA_BẠN_VÀO_ĐÂY')) return false;
  return member.roles.cache.has(roleId);
}
function saveRoleIdToConfig(roleKey, roleId) {
  try {
    if (!emojiConfig.roles) {
      emojiConfig.roles = {};
    }
    emojiConfig.roles[roleKey] = roleId;
    fs.writeFileSync(EMOJIS_PATH, JSON.stringify(emojiConfig, null, 2), 'utf8');
  } catch (err) {
    log.error(`Lỗi khi lưu ID role vào emojis.json`, err);
  }
}
async function getOrCreateRole(guild, roleName) {
  let role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
  if (!role) {
    try {
      role = await guild.roles.create({
        name: roleName,
        reason: 'Tự động tạo vai trò thông báo cho setup Play Together'
      });
    } catch (e) {
      log.error(`Không thể tạo role: ${roleName}. Vui lòng kiểm tra quyền MANAGE_ROLES của Bot.`, e);
    }
  }
  return role;
}
async function updateMemberRoles(interaction, categoryKeys, selectedValues) {
  const guild = interaction.guild;
  const member = interaction.member;
  if (!guild || !member) {
    return interaction.reply({ content: 'Lỗi: Không tìm thấy máy chủ hoặc thành viên.', ephemeral: true });
  }
  await interaction.deferUpdate();
  const addedRoles = [];
  const removedRoles = [];
  for (const optionValue of categoryKeys) {
    const def = roleDefinitions[optionValue];
    if (!def) continue;
    const isSelected = selectedValues.includes(optionValue);
    let role = await getOrCreateRole(guild, def.name);
    if (!role) continue;
    if (!emojiConfig.roles || emojiConfig.roles[def.key] !== role.id) {
      saveRoleIdToConfig(def.key, role.id);
    }
    if (isSelected) {
      if (!member.roles.cache.has(role.id)) {
        try {
          await member.roles.add(role);
          addedRoles.push(def.name);
        } catch (e) {
          log.error(`Không thể gán role ${def.name} cho user ${member.user.tag}`, e);
        }
      }
    } else {
      if (member.roles.cache.has(role.id)) {
        try {
          await member.roles.remove(role);
          removedRoles.push(def.name);
        } catch (e) {
          log.error(`Không thể thu hồi role ${def.name} của user ${member.user.tag}`, e);
        }
      }
    }
  }
  let statusText = `Đã cập nhật tùy chỉnh vai trò của bạn:\n`;
  if (addedRoles.length > 0) statusText += `✅ **Đã đăng ký:** ${addedRoles.join(', ')}\n`;
  if (removedRoles.length > 0) statusText += `❌ **Đã hủy đăng ký:** ${removedRoles.join(', ')}`;
  if (addedRoles.length === 0 && removedRoles.length === 0) statusText += `ℹ️ Không có thay đổi nào.`;
  try {
    await interaction.followUp({ content: statusText, ephemeral: true });
  } catch (e) { }
}
function buildSetupComponents(member) {
  const mapWithDefaults = (options) => {
    return options.map(opt => ({
      label: opt.label,
      value: opt.value,
      emoji: opt.emoji,
      default: userHasRole(member, opt.value)
    }));
  };
  return [
    new MessageActionRow().addComponents(
      new MessageSelectMenu()
        .setCustomId('setup_select_seeds')
        .setPlaceholder('Chọn hạt giống')
        .setMinValues(0)
        .setMaxValues(seedOptions.length)
        .addOptions(mapWithDefaults(seedOptions))
    ),
    new MessageActionRow().addComponents(
      new MessageSelectMenu()
        .setCustomId('setup_select_weather')
        .setPlaceholder('Chọn loại thời tiết')
        .setMinValues(0)
        .setMaxValues(weatherOptions.length)
        .addOptions(mapWithDefaults(weatherOptions))
    ),
    new MessageActionRow().addComponents(
      new MessageSelectMenu()
        .setCustomId('setup_select_tools')
        .setPlaceholder('Chọn loại nông cụ')
        .setMinValues(0)
        .setMaxValues(toolOptions.length)
        .addOptions(mapWithDefaults(toolOptions))
    ),
    new MessageActionRow().addComponents(
      new MessageSelectMenu()
        .setCustomId('setup_select_refresh')
        .setPlaceholder('Chọn thời gian làm mới')
        .setMinValues(0)
        .setMaxValues(refreshOptions.length)
        .addOptions(mapWithDefaults(refreshOptions))
    ),
    new MessageActionRow().addComponents(
      new MessageButton()
        .setCustomId('setup_refresh')
        .setLabel('Refresh')
        .setEmoji('🔄')
        .setStyle('SECONDARY')
    )
  ];
}
// ─── Creator command handlers ─────────────────────────────────────────────────

function _isAdmin(userId) {
  if (!setup.ADMIN_IDS || !Array.isArray(setup.ADMIN_IDS)) return false;
  const valid = setup.ADMIN_IDS.filter(id => id && id.trim() !== '' && !id.includes('ĐIỀN_ID_'));
  return valid.length === 0 || valid.includes(userId);
}

function _findInviteChannelForCreator(guild) {
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

async function handleCreatorCommand(interaction, guild) {
  if (!_isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này!', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  const targetUser = interaction.options.getUser('user');
  const guildId = guild.id;
  const userId = targetUser.id;

  // Kiểm tra Creator đã tồn tại chưa, và invite còn hoạt động không
  let doc = await Creator.findOne({ guildId, userId });
  if (doc?.inviteCode) {
    try {
      const allInvites = await guild.invites.fetch();
      if (allInvites.has(doc.inviteCode)) {
        return interaction.editReply({ embeds: [{ color: 0x5865f2,
          title: '✅ Creator đã tồn tại',
          description: `👤 <@${userId}> đã là Creator.\n🔗 Link invite: **${doc.inviteURL}**\n👥 Tổng join: **${doc.joinCount}**` }] });
      }
    } catch (_) {}
  }

  // Tạo invite mới
  const ch = _findInviteChannelForCreator(guild);
  if (!ch) {
    return interaction.editReply({ content: '❌ Bot không có quyền tạo link mời trên server này.' });
  }
  let invite;
  try {
    invite = await guild.invites.create(ch, { maxAge: 0, maxUses: 0, unique: true, reason: `Creator invite cho ${targetUser.tag}` });
  } catch (err) {
    return interaction.editReply({ content: `❌ Không thể tạo invite: ${err.message}` });
  }

  doc = await Creator.findOneAndUpdate(
    { guildId, userId },
    { $set: { inviteCode: invite.code, inviteURL: `https://discord.gg/${invite.code}` }, $setOnInsert: { joinCount: 0 } },
    { upsert: true, new: true }
  );

  // Thêm vào cache để hệ thống invite tracking nhận ra
  const gMap = inviteCache.get(guildId) ?? new Map();
  gMap.set(invite.code, 0);
  inviteCache.set(guildId, gMap);

  log.info(`[Creator] Thêm Creator mới: ${targetUser.tag} (${userId}) — code: ${invite.code}`);
  return interaction.editReply({ embeds: [{ color: 0x2ecc71,
    title: '✅ Đã thêm Creator mới',
    description: [
      `👤 Creator: <@${userId}>`,
      `🔗 Link invite: **${doc.inviteURL}**`,
      `📅 Ngày tạo: <t:${Math.floor(Date.now() / 1000)}:d>`,
    ].join('\n') }] });
}

async function handleCreatorStats(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });
  const creators = await Creator.find({ guildId: guild.id }).sort({ joinCount: -1 });
  if (creators.length === 0) {
    return interaction.editReply({ content: 'ℹ️ Chưa có Creator nào được thêm.' });
  }
  const lines = creators.map((c, i) => {
    const created = c.createdAt ? `<t:${Math.floor(new Date(c.createdAt).getTime() / 1000)}:d>` : 'N/A';
    return `**${i + 1}.** 👤 <@${c.userId}>\n🔗 ${c.inviteURL || 'N/A'}  ·  👥 **${c.joinCount}** joins  ·  📅 ${created}`;
  });
  return interaction.editReply({ embeds: [{ color: 0x5865f2,
    title: '📊 Thống kê Creator',
    description: lines.join('\n\n'),
    footer: { text: `Tổng: ${creators.length} Creator · Sắp xếp theo số lượt join` } }] });
}

async function handleCreatorReset(interaction, guild) {
  if (!_isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này!', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  const result = await Creator.updateMany({ guildId: guild.id }, { $set: { joinCount: 0 } });
  log.info(`[Creator] Reset thống kê — ${result.modifiedCount} Creator đã được reset.`);
  return interaction.editReply({ embeds: [{ color: 0xe67e22,
    title: '🔄 Đã reset thống kê Creator',
    description: `Đã đặt lại số lượt join của **${result.modifiedCount}** Creator về **0**.\n_Link invite được giữ nguyên._` }] });
}

// ─── UsageLimit admin commands ────────────────────────────────────────────────

async function handleUsageAdd(interaction, guild) {
  if (!_isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này!', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  const target = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const now    = new Date();
  const doc = await UsageLimit.findOneAndUpdate(
    { guildId: guild.id, userId: target.id },
    [{ $set: {
      uses:                    { $add: [{ $ifNull: ['$uses', 100] }, amount] },
      lastReset:               { $ifNull: ['$lastReset', now] },
      inviteMilestonesAwarded: { $ifNull: ['$inviteMilestonesAwarded', 0] },
    }}],
    { upsert: true, new: true },
  );
  log.info(`[UsageLimit] Admin ${interaction.user.tag} cộng +${amount} lượt cho ${target.tag} → còn ${doc.uses}`);
  return interaction.editReply({ embeds: [{ color: 0x2ecc71,
    description: `✅ Đã cộng **+${amount}** lượt cho <@${target.id}>.\n📊 Hiện tại còn: **${doc.uses} lượt**` }] });
}

async function handleUsageRemove(interaction, guild) {
  if (!_isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này!', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  const target = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const now    = new Date();
  const doc = await UsageLimit.findOneAndUpdate(
    { guildId: guild.id, userId: target.id },
    [{ $set: {
      uses:                    { $subtract: [{ $ifNull: ['$uses', 100] }, amount] },
      lastReset:               { $ifNull: ['$lastReset', now] },
      inviteMilestonesAwarded: { $ifNull: ['$inviteMilestonesAwarded', 0] },
    }}],
    { upsert: true, new: true },
  );
  log.info(`[UsageLimit] Admin ${interaction.user.tag} trừ -${amount} lượt của ${target.tag} → còn ${doc.uses}`);
  return interaction.editReply({ embeds: [{ color: 0xe74c3c,
    description: `✅ Đã trừ **-${amount}** lượt của <@${target.id}>.\n📊 Hiện tại còn: **${doc.uses} lượt**` }] });
}

async function handleUsageExemptAdd(interaction, guild) {
  if (!_isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này!', ephemeral: true });
  }
  const role = interaction.options.getRole('role');
  if (!config.exemptRoleIds) config.exemptRoleIds = [];
  if (config.exemptRoleIds.includes(role.id)) {
    return interaction.reply({ embeds: [{ color: 0xf39c12,
      description: `ℹ️ Role <@&${role.id}> đã có trong danh sách miễn giới hạn rồi.` }], ephemeral: true });
  }
  config.exemptRoleIds.push(role.id);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  log.info(`[UsageLimit] Admin ${interaction.user.tag} thêm exempt role: ${role.name} (${role.id})`);
  return interaction.reply({ embeds: [{ color: 0x2ecc71,
    description: `✅ Đã thêm <@&${role.id}> vào danh sách **miễn giới hạn**.\nThành viên có role này sẽ không bị giới hạn lượt sử dụng.` }], ephemeral: true });
}

async function handleUsageExemptRemove(interaction, guild) {
  if (!_isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này!', ephemeral: true });
  }
  const role = interaction.options.getRole('role');
  if (!config.exemptRoleIds) config.exemptRoleIds = [];
  const idx = config.exemptRoleIds.indexOf(role.id);
  if (idx === -1) {
    return interaction.reply({ embeds: [{ color: 0xf39c12,
      description: `ℹ️ Role <@&${role.id}> không có trong danh sách miễn giới hạn.` }], ephemeral: true });
  }
  config.exemptRoleIds.splice(idx, 1);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  log.info(`[UsageLimit] Admin ${interaction.user.tag} xóa exempt role: ${role.name} (${role.id})`);
  return interaction.reply({ embeds: [{ color: 0xe74c3c,
    description: `✅ Đã xóa <@&${role.id}> khỏi danh sách miễn giới hạn.` }], ephemeral: true });
}

async function handleUsageExemptList(interaction, guild) {
  const exemptRoleIds = config.exemptRoleIds || [];
  if (exemptRoleIds.length === 0) {
    return interaction.reply({ embeds: [{ color: 0x95a5a6,
      description: 'ℹ️ Chưa có role nào được miễn giới hạn lượt sử dụng.' }], ephemeral: true });
  }
  const lines = exemptRoleIds.map((id, i) => `**${i + 1}.** <@&${id}>`).join('\n');
  return interaction.reply({ embeds: [{ color: 0x5865f2,
    title: '🛡️ Danh sách role miễn giới hạn',
    description: lines,
    footer: { text: `Tổng: ${exemptRoleIds.length} role` } }], ephemeral: true });
}

// ─────────────────────────────────────────────────────────────────────────────
async function registerSlashCommands(guild) {
  try {
    const commandData = [
      {
        name: 'setup',
        description: 'Mở menu cấu hình nhận thông báo Play Together'
      },
      {
        name: 'creator',
        description: 'Thêm nhà quảng bá với link invite riêng (Admin)',
        options: [{ type: 6, name: 'user', description: 'Người dùng cần thêm làm Creator', required: true }]
      },
      {
        name: 'creator-stats',
        description: 'Xem thống kê tất cả Creator (sắp xếp theo số lượt join)'
      },
      {
        name: 'creator-reset',
        description: 'Reset số lượt join của tất cả Creator về 0 (Admin)'
      },
      {
        name: 'usage-add',
        description: 'Cộng thêm lượt sử dụng cho một người dùng (Admin)',
        options: [
          { type: 6, name: 'user',   description: 'Người dùng cần cộng lượt', required: true },
          { type: 4, name: 'amount', description: 'Số lượt cần cộng thêm',    required: true, min_value: 1 }
        ]
      },
      {
        name: 'usage-remove',
        description: 'Trừ lượt sử dụng của một người dùng (Admin)',
        options: [
          { type: 6, name: 'user',   description: 'Người dùng cần trừ lượt', required: true },
          { type: 4, name: 'amount', description: 'Số lượt cần trừ',         required: true, min_value: 1 }
        ]
      },
      {
        name: 'usage-exempt-add',
        description: 'Thêm role được miễn giới hạn lượt sử dụng (Admin)',
        options: [
          { type: 8, name: 'role', description: 'Role cần miễn giới hạn', required: true }
        ]
      },
      {
        name: 'usage-exempt-remove',
        description: 'Xóa role khỏi danh sách miễn giới hạn (Admin)',
        options: [
          { type: 8, name: 'role', description: 'Role cần xóa khỏi danh sách miễn', required: true }
        ]
      },
      {
        name: 'usage-exempt-list',
        description: 'Xem danh sách tất cả role được miễn giới hạn lượt sử dụng'
      }
    ];
    if (guild.commands) {
      await guild.commands.set(commandData);
    } else {
      await botClient.api.applications(botClient.user.id).guilds(guild.id).commands.put({
        data: commandData
      });
    }
  } catch (err) {
    log.error(`Lỗi đăng ký slash command cho server ${guild.name}:`, err.message || err);
  }
}
async function registerCommandsForTargetGuilds() {
  const processedGuilds = new Set();
  for (const mapping of config.channelMappings) {
    if (mapping.targetChannelId) {
      try {
        const targetChannel = await botClient.channels.fetch(mapping.targetChannelId);
        if (targetChannel && targetChannel.guild) {
          const guild = targetChannel.guild;
          if (!processedGuilds.has(guild.id)) {
            processedGuilds.add(guild.id);
            await registerSlashCommands(guild);
          }
        }
      } catch (err) {
        log.warn(`Không thể lấy guild cho kênh đích ${mapping.targetChannelId} để đăng ký slash commands: ${err.message}`);
      }
    }
  }
}
// ─── UsageLimit helpers ───────────────────────────────────────────────────────

/**
 * Lấy hoặc tạo document UsageLimit cho user.
 * Nếu đã qua tháng mới → tự động cộng thêm 100 lượt.
 */
async function getOrCreateUsageLimit(guildId, userId) {
  const now = new Date();
  let doc = await UsageLimit.findOne({ guildId, userId });
  if (!doc) {
    doc = await UsageLimit.create({ guildId, userId, uses: 100, lastReset: now });
    return doc;
  }
  const last = new Date(doc.lastReset);
  if (last.getMonth() !== now.getMonth() || last.getFullYear() !== now.getFullYear()) {
    doc = await UsageLimit.findOneAndUpdate(
      { guildId, userId },
      { $inc: { uses: 100 }, $set: { lastReset: now } },
      { new: true },
    );
    log.info(`[UsageLimit] +100 lượt tháng mới cho user ${userId} (còn lại: ${doc.uses})`);
  }
  return doc;
}

/**
 * Trừ 1 lượt sử dụng của tất cả thành viên (không phải bot) có một trong các roleId.
 * Dùng aggregation pipeline để xử lý đúng cả trường hợp document chưa tồn tại.
 */
async function deductUsageLimitForRoles(guild, roleIds) {
  try {
    const exemptRoleIds = config.exemptRoleIds || [];
    const affectedUserIds = new Set();
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);
      if (role) role.members.forEach(m => {
        if (m.user.bot) return;
        const isExempt = exemptRoleIds.length > 0 && m.roles.cache.some(r => exemptRoleIds.includes(r.id));
        if (!isExempt) affectedUserIds.add(m.id);
      });
    }
    if (!affectedUserIds.size) return;

    const guildId = guild.id;
    const now     = new Date();
    const ops = [...affectedUserIds].map(userId => ({
      updateOne: {
        filter: { guildId, userId },
        update: [{
          $set: {
            uses:                    { $subtract: [{ $ifNull: ['$uses', 100] }, 1] },
            lastReset:               { $ifNull: ['$lastReset', now] },
            inviteMilestonesAwarded: { $ifNull: ['$inviteMilestonesAwarded', 0] },
          },
        }],
        upsert: true,
      },
    }));
    await UsageLimit.bulkWrite(ops, { ordered: false });
    log.info(`[UsageLimit] Trừ 1 lượt của ${affectedUserIds.size} thành viên (guild: ${guildId})`);
  } catch (err) {
    log.error('[UsageLimit] Lỗi deductUsageLimitForRoles:', err.message);
  }
}

botClient.on('interactionCreate', async (interaction) => {
  try {
    const guild = interaction.guild || (interaction.guildId ? await botClient.guilds.fetch(interaction.guildId).catch(() => null) : null);
    if (!guild) {
      return;
    }
    const member = interaction.member || (interaction.user ? await guild.members.fetch(interaction.user.id).catch(() => null) : null);
    if (!member) {
      return;
    }
    if (interaction.isCommand()) {
      if (interaction.commandName === 'creator') {
        await handleCreatorCommand(interaction, guild);
      } else if (interaction.commandName === 'creator-stats') {
        await handleCreatorStats(interaction, guild);
      } else if (interaction.commandName === 'creator-reset') {
        await handleCreatorReset(interaction, guild);
      } else if (interaction.commandName === 'usage-add') {
        await handleUsageAdd(interaction, guild);
      } else if (interaction.commandName === 'usage-remove') {
        await handleUsageRemove(interaction, guild);
      } else if (interaction.commandName === 'usage-exempt-add') {
        await handleUsageExemptAdd(interaction, guild);
      } else if (interaction.commandName === 'usage-exempt-remove') {
        await handleUsageExemptRemove(interaction, guild);
      } else if (interaction.commandName === 'usage-exempt-list') {
        await handleUsageExemptList(interaction, guild);
      } else if (interaction.commandName === 'setup') {
        const isServerAdmin = interaction.member && interaction.member.permissions &&
          interaction.member.permissions.has('ADMINISTRATOR');
        if (!isServerAdmin) {
          return interaction.reply({
            content: '❌ Bạn cần quyền **Quản trị viên** để sử dụng lệnh này!',
            ephemeral: true
          });
        }
        await interaction.reply({
          content: '⏳ Đang đồng bộ và khởi tạo các vai trò trên máy chủ, vui lòng đợi một chút...'
        });
        let hasChanges = false;
        if (guild) {
          for (const def of Object.values(roleDefinitions)) {
            let roleId = emojiConfig.roles ? emojiConfig.roles[def.key] : null;
            let role = null;
            if (roleId) {
              role = guild.roles.cache.get(roleId);
            }
            if (!role) {
              role = await getOrCreateRole(guild, def.name);
              if (role) {
                if (!emojiConfig.roles) emojiConfig.roles = {};
                emojiConfig.roles[def.key] = role.id;
                hasChanges = true;
              }
            }
          }
        }
        if (hasChanges) {
          try {
            fs.writeFileSync(EMOJIS_PATH, JSON.stringify(emojiConfig, null, 2), 'utf8');
          } catch (err) {
            log.error(`Lỗi khi lưu ID role vào emojis.json:`, err);
          }
        }
        const embed = {
          title: 'Tuỳ Chỉnh Thông Báo',
          description: [
            '────────────────────────────────────',
            'Nhấn cài đặt thông báo để chọn loại thông báo bạn muốn nhận.',
            'Sau khi ấn sẽ hiển thị bản cài đặt, bạn chỉ cần chọn loại hạt, thời tiết, nông cụ mà bạn muốn nhận thông báo khi cửa hàng vừa làm mới.'
          ].join('\n'),
          color: 0x2b2d31
        };
        const row = new MessageActionRow().addComponents(
          new MessageButton()
            .setCustomId('setup_customize')
            .setLabel('Tùy chỉnh thông báo')
            .setStyle('SUCCESS'),
          new MessageButton()
            .setCustomId('setup_clear_all')
            .setLabel('Tắt tất cả thông báo')
            .setStyle('DANGER')
        );
        await interaction.editReply({
          content: null,
          embeds: [embed],
          components: [row]
        });
      }
    } else if (interaction.isButton()) {
      if (interaction.customId === 'setup_customize') {
        // ── Kiểm tra giới hạn lượt sử dụng ────────────────────────────────
        const exemptRoleIds = config.exemptRoleIds || [];
        const isExempt = exemptRoleIds.length > 0 &&
          member.roles.cache.some(r => exemptRoleIds.includes(r.id));
        const usageDoc = isExempt ? null : await getOrCreateUsageLimit(guild.id, interaction.user.id);
        if (!isExempt && usageDoc.uses <= 0) {
          const limitEmbed = {
            color: 0xe74c3c,
            description: [
              '━━━━━━━━━━━━━━━━━━',
              '',
              '### <:exclamation:1532333725155856556> BẠN ĐÃ HẾT 100 LƯỢT SỬ DỤNG TRONG THÁNG NÀY',
              '',
              'Để tiếp tục sử dụng tính năng thông báo, vui lòng chọn một trong hai cách sau:',
              '',
              '<a:575241fastflashingarrowright:1532844428480352409> Donate để mở khóa và sử dụng ngay.',
              '',
              '<a:575241fastflashingarrowright:1532844428480352409> Mời **03 người bạn** tham gia để nhận thêm 300 lượt sử dụng miễn phí.',
              '',
              '━━━━━━━━━━━━━━━━━━',
            ].join('\n'),
          };
          const limitRow = new MessageActionRow().addComponents(
            new MessageButton()
              .setLabel('Donate')
              .setEmoji({ id: '1532821459557417173', name: 'donate', animated: true })
              .setStyle('LINK')
              .setURL('https://discord.com/channels/1363986043509932093/1514934088870662184'),
            new MessageButton()
              .setCustomId('usageLimit_invite')
              .setLabel('Mời Bạn Bè')
              .setEmoji({ id: '1532341617116057610', name: '94710cartoonheartshiny' })
              .setStyle('PRIMARY'),
          );
          await interaction.reply({ embeds: [limitEmbed], components: [limitRow], ephemeral: true });
          return;
        }
        // ── Còn lượt: mở giao diện bình thường ────────────────────────────
        const rows = buildSetupComponents(member);
        await interaction.reply({
          components: rows,
          ephemeral: true
        });
      } else if (interaction.customId === 'usageLimit_invite') {
        await inviteSystem.handleUsageLimitInviteButton(interaction, guild);
      } else if (interaction.customId === 'setup_clear_all') {
        await interaction.deferUpdate();
        const rolesToRemove = [];
        for (const opt of Object.values(roleDefinitions)) {
          if (emojiConfig.roles && emojiConfig.roles[opt.key]) {
            const roleId = emojiConfig.roles[opt.key];
            if (roleId && !roleId.includes('ĐIỀN_ID_ROLE_') && !roleId.includes('ĐIỀN_ID_ROLE_CỦA_BẠN_VÀO_ĐÂY') && member.roles.cache.has(roleId)) {
              rolesToRemove.push(roleId);
            }
          }
        }
        if (rolesToRemove.length > 0) {
          try {
            await member.roles.remove(rolesToRemove);
            await interaction.followUp({ content: '✅ Đã gỡ bỏ toàn bộ vai trò nhận thông báo của bạn!', ephemeral: true });
          } catch (e) {
            log.error(`Không thể gỡ bỏ vai trò`, e);
            await interaction.followUp({ content: '❌ Lỗi khi gỡ bỏ vai trò, vui lòng thử lại.', ephemeral: true });
          }
        } else {
          await interaction.followUp({ content: 'ℹ️ Bạn hiện chưa cài đặt vai trò nhận thông báo nào.', ephemeral: true });
        }
      } else if (interaction.customId === 'setup_refresh') {
        await interaction.deferUpdate();
        const rows = buildSetupComponents(member);
        await interaction.editReply({
          content: null,
          embeds: [],
          components: rows
        });
      } else if (interaction.customId === 'setup_all_notifs') {
        await interaction.deferUpdate();
        const mainKeys = ['main_seed', 'main_weather', 'main_tool', 'main_refresh'];
        const added = [];
        for (const key of mainKeys) {
          const def = roleDefinitions[key];
          const role = await getOrCreateRole(guild, def.name);
          if (role) {
            if (!emojiConfig.roles || emojiConfig.roles[def.key] !== role.id) {
              saveRoleIdToConfig(def.key, role.id);
            }
            if (!member.roles.cache.has(role.id)) {
              await member.roles.add(role);
              added.push(def.name);
            }
          }
        }
        if (added.length > 0) {
          await interaction.followUp({ content: `✅ Đã thêm vai trò theo dõi tất cả kênh chính: **${added.join(', ')}**`, ephemeral: true });
        } else {
          await interaction.followUp({ content: `ℹ️ Bạn đã theo dõi tất cả các kênh thông báo chính rồi.`, ephemeral: true });
        }
      }
    } else if (interaction.isSelectMenu()) {
      const selected = interaction.values;
      if (interaction.customId === 'setup_select_seeds') {
        const seedKeys = seedOptions.map(opt => opt.value);
        await updateMemberRoles(interaction, seedKeys, selected);
      } else if (interaction.customId === 'setup_select_weather') {
        const weatherKeys = weatherOptions.map(opt => opt.value);
        await updateMemberRoles(interaction, weatherKeys, selected);
      } else if (interaction.customId === 'setup_select_tools') {
        const toolKeys = toolOptions.map(opt => opt.value);
        await updateMemberRoles(interaction, toolKeys, selected);
      } else if (interaction.customId === 'setup_select_refresh') {
        const refreshKeys = refreshOptions.map(opt => opt.value);
        await updateMemberRoles(interaction, refreshKeys, selected);
      }
    }
  } catch (err) {
    log.error('Lỗi khi xử lý tương tác (interaction):', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ Đã xảy ra lỗi khi xử lý tương tác: ${err.message}`, ephemeral: true });
      } else {
        await interaction.followUp({ content: `❌ Đã xảy ra lỗi khi xử lý tương tác: ${err.message}`, ephemeral: true });
      }
    } catch (replyErr) {
      log.error('Không thể phản hồi báo lỗi tương tác:', replyErr);
    }
  }
});
client.on('ready', async () => {
  log.success(`[Selfbot] Đã đăng nhập tài khoản đọc: ${colors.bright}${client.user.tag}${colors.reset} (ID: ${client.user.id})`);
});
botClient.on('ready', async () => {
  log.success(`[Bot] Đã đăng nhập tài khoản gửi: ${colors.bright}${botClient.user.tag}${colors.reset} (ID: ${botClient.user.id})`);
  log.info('Đang kiểm tra quyền truy cập các kênh đích...');
  for (const mapping of config.channelMappings) {
    if (mapping.targetChannelId) {
      try {
        const targetChannel = await botClient.channels.fetch(mapping.targetChannelId);
        if (targetChannel) {
          const targetServer = targetChannel.guild ? targetChannel.guild.name : 'DM';
          log.info(`[Liên Kết Đích] Kênh: ${colors.green}${targetServer} > #${targetChannel.name}${colors.reset}`);
        }
      } catch (err) {
        log.warn(`Bot không thể truy cập kênh đích ID: ${mapping.targetChannelId}. Lỗi: ${err.message}`);
      }
    }
  }
  await registerCommandsForTargetGuilds();
  // Kết nối MongoDB
  try {
    await connectDB();
    log.success('Đã kết nối MongoDB!');
  } catch (dbErr) {
    log.warn('Không thể kết nối MongoDB — hệ thống giới hạn sử dụng sẽ bị tắt: ' + dbErr.message);
  }
  // Cache invite cho tất cả guild hiện tại
  for (const g of botClient.guilds.cache.values()) {
    try {
      const invites = await g.invites.fetch();
      const gMap = new Map();
      invites.forEach(inv => gMap.set(inv.code, inv.uses ?? 0));
      inviteCache.set(g.id, gMap);
      log.info(`Đã cache ${gMap.size} invite(s) cho server: ${g.name}`);
    } catch (err) {
      log.warn(`Không thể cache invite cho server ${g.name}: ${err.message}`);
    }
  }
  // Khởi tạo hệ thống invite (sau khi cache đã được populate)
  inviteSystem.init(inviteCache, log, botClient);
  log.success(`Bot thông báo đã sẵn sàng!`);
});
async function forwardMessage(message, mapping) {
  const serverName = message.guild ? message.guild.name : 'DM';
  const channelName = message.channel.name || 'DM';
  if (!mapping.targetChannelId) {
    log.error(`Không có cấu hình kênh đích cho kênh nguồn ${message.channel.id}`);
    return;
  }

  // Compute raw message signature synchronously to prevent race conditions
  let rawSig = message.content || '';
  if (!rawSig && message.components) {
    rawSig = extractComponentText(message.components);
  }
  if (message.embeds && message.embeds.length > 0) {
    rawSig += '\n' + message.embeds.map(e => `${e.title || ''}\n${e.description || ''}`).join('\n');
  }
  rawSig = rawSig
    .replace(/<@&?\d+>|<#\d+>|<a?:[a-zA-Z0-9_~]+:[0-9]+>/g, '')
    .replace(/[\s\p{P}\d]/gu, '')
    .toLowerCase()
    .trim();

  const cacheKey = mapping.targetChannelId;
  const now = Date.now();
  const previous = lastSentMessages.get(cacheKey);
  if (previous && previous.signature === rawSig && (now - previous.timestamp) < 15000) {
    log.info(`Bỏ qua tin nhắn trùng lặp gửi tới kênh ${cacheKey} trong vòng 15 giây.`);
    return;
  }
  lastSentMessages.set(cacheKey, { signature: rawSig, timestamp: now });

  let targetChannel;
  try {
    targetChannel = await botClient.channels.fetch(mapping.targetChannelId);
  } catch (err) {
    log.error(`Bot không tìm thấy hoặc không có quyền gửi vào kênh đích ID: ${mapping.targetChannelId}`, err.message);
    return;
  }
  const sourceGuildId = message.guild ? message.guild.id : null;
  const targetGuild = await getTargetGuild(mapping, sourceGuildId);
  const payload = await formatPlayTogetherNotification(message, targetGuild);

  if (mapping.type === 'refresh' && payload && payload.embeds) {
    payload.embeds = payload.embeds.map(emb => {
      let newEmb = { ...emb, color: 0xED4245 };
      // Thêm thumbnail cho embed "Đơn hàng đã được làm mới"
      if ((newEmb.title || '').includes('Đơn hàng đã được làm mới')) {
        newEmb.thumbnail = { url: 'https://media.discordapp.net/stickers/1532096361980494035.webp?size=160&quality=lossless' };
      }
      // Thêm thumbnail cho embed "Cửa hàng nội thất đã được làm mới"
      if ((newEmb.title || '').includes('Cửa hàng nội thất đã được làm mới')) {
        newEmb.thumbnail = { url: 'https://media.discordapp.net/stickers/1532096752289579078.webp?size=160&quality=lossless' };
      }
      // Thêm thumbnail cho embed "Cửa hàng nông cụ đã được làm mới"
      if ((newEmb.title || '').includes('Cửa hàng nông cụ đã được làm mới')) {
        newEmb.thumbnail = { url: 'https://media.discordapp.net/stickers/1532113198118076691.webp?size=160&quality=lossless' };
      }
      if (newEmb.title) {
        const titleText = newEmb.title;
        const currentDesc = newEmb.description || '';
        const newDesc = `### ${titleText}\n${currentDesc}`;
        newEmb = { ...newEmb, description: newDesc };
        delete newEmb.title;
      }
      // Hàm chuẩn hoá dòng "Thời gian: HH:mm ~ HH:mm" → "### Thời gian | HH:mm ~ HH:mm"
      // - Xử lý mọi tổ hợp bold/italic marker (**, *, __) bao quanh label hoặc giá trị
      // - Xử lý cả ASCII (:, ~, -) lẫn Unicode full-width (：, ～)
      // - Nuốt luôn các trailing marker (**) còn sót sau khi leading marker đã bị stripped
      const normalizeTimeLines = (text) => {
        if (!text) return text;
        // Bảo vệ "Thời gian bán" trước (dạng riêng, giữ bold)
        const result = text
          .replace(/[\*_]*Thời gian bán[\*_]*\s*[：:]\s*`?(\d{1,2}[：:]\d{2})`?\s*[～~]\s*`?(\d{1,2}[：:]\d{2})`?[\*_]*/gi,
            '**Thời gian bán︱$1 ~ $2**')
          // Hai mốc giờ: bất kỳ markdown wrapper nào quanh label/giá trị, dấu phân cách -, –, —, ~, ～
          .replace(/[\*_]*Thời gian[\*_]*\s*[：:]\s*[\*_]*`?(\d{1,2}[：:]\d{2})`?[\*_]*\s*[-–—～~]\s*[\*_]*`?(\d{1,2}[：:]\d{2})`?[\*_]*/gi,
            '### Thời gian | $1 ~ $2')
          // Một mốc giờ duy nhất
          .replace(/[\*_]*Thời gian[\*_]*\s*[：:]\s*[\*_]*`?(\d{1,2}[：:]\d{2})`?[\*_]*(?!\s*[-–—～~\d:])/gi,
            '### Thời gian | $1');
        return result;
      };
      if (newEmb.description) {
        newEmb.description = normalizeTimeLines(newEmb.description);
      }
      // Áp dụng thêm cho field values (nếu "Thời gian" nằm trong field)
      if (newEmb.fields && newEmb.fields.length > 0) {
        newEmb.fields = newEmb.fields.map(f => ({
          ...f,
          value: normalizeTimeLines(f.value)
        }));
      }
      return newEmb;
    });
  }

  // Thêm thumbnail GIF (góc phải) cho kênh báo-hạt-giống
  if (mapping.type === 'seeds' && payload && payload.embeds) {
    payload.embeds = payload.embeds.map(emb => ({
      ...emb,
      thumbnail: { url: 'https://media.discordapp.net/stickers/1532148291385692320.gif?size=160' }
    }));
  }

  // Thêm thumbnail GIF (góc phải) cho kênh báo-nông-cụ
  if (mapping.type === 'tools' && payload && payload.embeds) {
    payload.embeds = payload.embeds.map(emb => ({
      ...emb,
      thumbnail: { url: 'https://media.discordapp.net/stickers/1532144032405520576.gif?size=160' }
    }));
  }

  // Chèn dòng điều hướng cài đặt vào cuối mỗi embed (tất cả kênh thông báo có type)
  const SETUP_FOOTER = '-# Chỉnh thông báo [tại đây](https://discord.com/channels/880309287056965633/1531672149276758067)';
  if (mapping.type && payload && payload.embeds) {
    payload.embeds = payload.embeds.map(emb => ({
      ...emb,
      description: emb.description ? `${emb.description}\n${SETUP_FOOTER}` : SETUP_FOOTER,
    }));
  }

  const files = [];
  if (config.forwardAttachments && message.attachments && message.attachments.size > 0) {
    message.attachments.forEach(attachment => {
      files.push(attachment.url);
    });
  }
  if (files.length > 0) {
    payload.files = files;
  }
  try {
    const isNongCu  = mapping.type === 'tools';
    const isRefresh = mapping.type === 'refresh';

    if (isNongCu || isRefresh) {
      // Gửi ping role riêng TRƯỚC, tự xóa sau 30 phút — embed không bị chỉnh sửa
      const sendPing = async (content, roleIds) => {
        try {
          const pingMsg = await targetChannel.send({
            content,
            allowedMentions: { roles: roleIds },
          });
          setTimeout(async () => {
            try { await pingMsg.delete(); } catch (_) {}
          }, 30 * 60 * 1000);
        } catch (pingErr) {
          log.error('[Ping] Không thể gửi ping role:', pingErr.message);
        }
      };

      // refresh-gian-hàng: ping nông cụ nếu embed báo làm mới
      if (isRefresh) {
        const embedTexts = (payload.embeds || [])
          .map(e => `${e.title || ''} ${e.description || ''}`)
          .join(' ')
          .toLowerCase();
        if (embedTexts.includes('cửa hàng nông cụ đã được làm mới')) {
          const toolshopRoleId = emojiConfig.roles && emojiConfig.roles['refresh_toolshop'];
          if (toolshopRoleId) {
            await sendPing(`<@&${toolshopRoleId}>`, [toolshopRoleId]);
          }
          // Kênh 1531684411202994356: ping thêm role riêng, tự xóa sau 30 phút
          if (mapping.targetChannelId === '1531684411202994356') {
            await sendPing('<@&1532160502120054944>', ['1532160502120054944']);
          }
        }
      }

      // Ping từ payload.content (role detect tự động)
      if (payload.content) {
        const taggedRoleIds = (payload.content.match(/<@&(\d+)>/g) || []).map(m => m.replace(/<@&(\d+)>/, '$1'));
        await sendPing(payload.content, taggedRoleIds);
      }

      // Gửi embed không có content
      const embedPayload = { ...payload };
      delete embedPayload.content;
      await targetChannel.send(embedPayload);

    } else {
      // Các kênh khác: gửi content+embed cùng lúc, tự edit xóa ping sau 5 phút
      const sentMessage = await targetChannel.send(payload);
      if (payload.content) {
        const taggedRoleIds = (payload.content.match(/<@&(\d+)>/g) || []).map(m => m.replace(/<@&(\d+)>/, '$1'));
        setTimeout(async () => {
          try {
            await sentMessage.edit({ content: null });
          } catch (editErr) {
            log.error(`Lỗi khi tự động xóa ping vai trò:`, editErr.message);
          }
        }, 5 * 60 * 1000);
      }
    }

    // ── Trừ 1 lượt của các thành viên có role được tag ──────────────────────
    if (payload.content && targetChannel.guild) {
      const pinnedRoleIds = (payload.content.match(/<@&(\d+)>/g) || [])
        .map(m => m.match(/\d+/)[0]);
      if (isRefresh) {
        const toolshopRoleId = emojiConfig.roles && emojiConfig.roles['refresh_toolshop'];
        if (toolshopRoleId) pinnedRoleIds.push(toolshopRoleId);
        pinnedRoleIds.push('1532160502120054944');
      }
      if (pinnedRoleIds.length > 0) {
        await deductUsageLimitForRoles(targetChannel.guild, pinnedRoleIds);
      }
    }
  } catch (err) {
    log.error(`Không thể gửi tin nhắn qua Bot tới kênh đích ID: ${mapping.targetChannelId}. Lỗi:`, err.message);
  }
}

// ─── Invite tracking on member join/leave ────────────────────────────────────

botClient.on('messageCreate', (message) => handleReminderEmbed(message).catch(() => {}));

botClient.on('inviteCreate', (invite) => inviteSystem.handleInviteCreate(invite));
botClient.on('inviteDelete', (invite) => inviteSystem.handleInviteDelete(invite));

botClient.on('guildMemberAdd',    async (member) => inviteSystem.handleGuildMemberAdd(member));
botClient.on('guildMemberRemove', async (member) => inviteSystem.handleGuildMemberRemove(member));

// ─────────────────────────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  const mapping = config.channelMappings.find(m => m.sourceChannelId === message.channel.id);
  if (!mapping) return;
  if (config.ignoreSelf && message.author.id === client.user.id) return;
  if (config.ignoreBots && message.author.bot) return;
  try {
    if (config.messageDelay && config.messageDelay > 0) {
      await sleep(config.messageDelay);
    }
    await forwardMessage(message, mapping);
  } catch (error) {
    log.error(`Gặp lỗi khi chuyển tiếp tin nhắn từ ID ${message.id}:`, error);
  }
});
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (data) => {
  const command = data.trim().toLowerCase();
  if (command === 'test') {
    log.info('Đang chạy thử nghiệm chuyển tiếp tin nhắn gần nhất từ các kênh nguồn...');
    let successCount = 0;
    for (const mapping of config.channelMappings) {
      try {
        log.info(`Đang thử nghiệm kênh nguồn: ${mapping.sourceChannelId}`);
        const sourceChannel = await client.channels.fetch(mapping.sourceChannelId, { force: true });
        if (!sourceChannel) {
          log.warn(`Không tìm thấy kênh nguồn ID ${mapping.sourceChannelId} (hoặc tài khoản không có quyền xem).`);
          continue;
        }
        const messages = await sourceChannel.messages.fetch({ limit: 20 });
        const lastMsg = messages.find(m => {
          if (config.ignoreBots && m.author.bot) return false;
          let compText = '';
          if (m.components && m.components.length > 0) {
            compText = extractComponentText(m.components);
          }
          const hasContent = (typeof m.content === 'string' && m.content.trim() !== '') || (compText.trim() !== '');
          const hasEmbeds = m.embeds && m.embeds.length > 0;
          const hasFiles = m.attachments && m.attachments.size > 0;
          return hasContent || hasEmbeds || hasFiles;
        });
        if (lastMsg) {
          await forwardMessage(lastMsg, mapping);
          successCount++;
        } else {
          log.warn(`Không tìm thấy tin nhắn hợp lệ gần đây ở kênh #${sourceChannel.name} (ID: ${mapping.sourceChannelId}).`);
        }
      } catch (err) {
        log.error(`Lỗi khi test kênh nguồn ID ${mapping.sourceChannelId}:`, err);
      }
    }
    log.success(`Hoàn tất thử nghiệm! Chuyển tiếp thành công từ ${successCount}/${config.channelMappings.length} kênh nguồn.`);
  }
});
client.on('error', (error) => {
  log.error('Đã xảy ra lỗi kết nối Discord Selfbot Client:', error);
});
botClient.on('error', (error) => {
  log.error('Đã xảy ra lỗi kết nối Discord Bot Client:', error);
});
// ── Health check server (chỉ chạy trong production) ───────────────
if (process.env.NODE_ENV === 'production') {
  const http = require('http');
  const PORT = process.env.PORT || 8080;
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', bot: 'notibot' }));
  }).listen(PORT, () => {
    log.info(`Health server đang lắng nghe trên cổng ${PORT}`);
  });
}

process.on('unhandledRejection', (reason, promise) => {
  log.error('Có lỗi chưa được xử lý trong Promise:', reason);
});
process.on('uncaughtException', (error) => {
  log.error('Có lỗi nghiêm trọng chưa được bắt (uncaughtException):', error);
});
log.info('Đang kết nối tới Discord...');
client.login(discordToken).catch(err => {
  log.error('Không thể đăng nhập tài khoản Selfbot!', err);
});
botClient.login(botToken).catch(err => {
  log.error('Không thể đăng nhập Bot thông báo!', err);
});