// Telegram Bot API integration for sending alerts
import sharp from 'sharp';

export async function sendTelegramMessage(message, options = {}) {
  const botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('Telegram bot token or chat ID not configured');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...options.extraParams
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telegram API error: ${error}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    throw error;
  }
}

export async function sendTelegramPhoto(photo, caption, options = {}) {
  const botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('Telegram bot token or chat ID not configured');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;

  // Create FormData for file upload
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('parse_mode', 'HTML');
  formData.append('caption', caption || '');
  
  // Convert SVG string to PNG buffer
  if (typeof photo === 'string' && photo.includes('<svg')) {
    try {
      const pngBuffer = await svgToPng(photo);
      const blob = new Blob([pngBuffer], { type: 'image/png' });
      formData.append('photo', blob, 'chart.png');
    } catch (error) {
      console.error('SVG to PNG conversion failed, sending as document:', error);
      // Fallback to sending as SVG document
      return sendTelegramDocument(photo, caption, { ...options, filename: 'chart.svg' });
    }
  } else {
    // Assume it's already a buffer or blob
    formData.append('photo', photo, 'chart.png');
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telegram photo API error: ${error}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to send Telegram photo:', error);
    throw error;
  }
}

// Convert SVG to PNG buffer using Sharp
async function svgToPng(svgString, width = 800, height = 600) {
  try {
    const pngBuffer = await sharp(Buffer.from(svgString))
      .resize(width, height, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 } // White background
      })
      .png()
      .toBuffer();
    
    return pngBuffer;
  } catch (error) {
    console.error('Sharp SVG conversion error:', error);
    throw error;
  }
}

export async function sendTelegramDocument(document, caption, options = {}) {
  const botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('Telegram bot token or chat ID not configured');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;

  // Create FormData for file upload
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('parse_mode', 'HTML');
  formData.append('caption', caption || '');
  
  // Send SVG as document
  if (typeof document === 'string' && document.includes('<svg')) {
    const buffer = Buffer.from(document, 'utf-8');
    const blob = new Blob([buffer], { type: 'image/svg+xml' });
    formData.append('document', blob, options.filename || 'chart.svg');
  } else {
    formData.append('document', document, options.filename || 'chart.svg');
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telegram document API error: ${error}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to send Telegram document:', error);
    throw error;
  }
}

export function formatTelegramAlert(pair, direction, low, high, prev, curr, pos) {
  const t = new Date(curr.ts).toISOString().replace("T", " ").slice(0, 16);
  
  const directionEmoji = direction === 'bullish' ? '🟢' : '🔴';
  const directionText = direction.toUpperCase();
  
  return `
${directionEmoji} <b>${directionText} ENGULFING DETECTED</b>

<b>Pair:</b> ${pair.name} (${pair.symbol})
<b>Exchange:</b> ${pair.exchange.toUpperCase()}
<b>Level:</b> ${low} - ${high}
<b>Time (UTC):</b> ${t}

📊 <b>Signal Candle:</b>
Open: ${curr.open} | High: ${curr.high}
Low: ${curr.low} | Close: ${curr.close}

📊 <b>Previous Candle:</b>
Open: ${prev.open} | High: ${prev.high}
Low: ${prev.low} | Close: ${prev.close}

${pos ? `💰 <b>Position Info:</b>
Entry: ${pos.entry}
Stop Loss: ${pos.stop} (${pos.slPips} pips)
Take Profit: ${pos.tp}
Lot Size: ${pos.lots}
Risk: $${pos.riskUsd}` : ''}

🔗 <a href="${`https://www.tradingview.com/chart/?symbol=${pair.tradingview || `${pair.exchange.toUpperCase()}:${pair.name}`}`}">View on TradingView</a>
  `.trim();
}

export async function testTelegramConnection() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    throw new Error('Telegram bot token not configured');
  }

  const url = `https://api.telegram.org/bot${botToken}/getMe`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.result;
  } catch (error) {
    console.error('Failed to test Telegram connection:', error);
    throw error;
  }
}