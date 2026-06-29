import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { readStore } from "@/lib/store";
import { sendTelegramMessage, sendTelegramPhoto, testTelegramConnection } from "@/lib/telegram";
import { buildChartSVG } from "@/lib/chart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { message, chatId, testChart } = await req.json();
    const store = await readStore(user);
    const telegramSettings = store.settings.telegram || {};

    if (message || testChart) {
      // Send test message using settings or env vars
      const botToken = telegramSettings.botToken || process.env.TELEGRAM_BOT_TOKEN;
      const targetChatId = chatId || telegramSettings.chatId || process.env.TELEGRAM_CHAT_ID;
      
      if (!botToken || !targetChatId) {
        return NextResponse.json({ 
          error: "Telegram bot token or chat ID not configured in settings",
          success: false 
        }, { status: 400 });
      }

      if (testChart) {
        // Send a test chart image
        try {
          // Create a sample chart SVG for testing
          const testSvg = `<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#1a1a1a"/>
            <text x="400" y="200" text-anchor="middle" fill="#00ff88" font-size="24" font-family="Arial">
              📊 Test Chart from Engulfing Dashboard
            </text>
            <text x="400" y="250" text-anchor="middle" fill="#888" font-size="16" font-family="Arial">
              Chart images will appear here with highlighted engulfing patterns
            </text>
          </svg>`;
          
          const testCaption = `🚀 <b>Test Chart Message</b>

This is how your Telegram alerts will look with chart images!

📊 <b>Features:</b>
• Chart with highlighted engulfing patterns
• Price levels marked
• Signal candle highlighted
• Full trade details in caption

✅ Chart image functionality is working correctly!`;

          const result = await sendTelegramPhoto(
            testSvg,
            testCaption,
            { botToken, chatId: targetChatId }
          );
          
          return NextResponse.json({ 
            success: true, 
            message: "Test chart image sent successfully",
            result 
          });
        } catch (error) {
          // Fallback to text message if image fails
          const fallbackMessage = `🚀 Test message from Engulfing Alerts Dashboard

❌ Chart image test failed: ${error.message}

But text messages are working correctly! 
Chart images will be sent when available.`;
          
          const result = await sendTelegramMessage(
            fallbackMessage,
            { botToken, chatId: targetChatId }
          );
          
          return NextResponse.json({ 
            success: true, 
            message: "Image failed but text message sent",
            error: error.message,
            result 
          });
        }
      } else {
        // Send regular text test message
        const result = await sendTelegramMessage(
          message || "🚀 Test message from Engulfing Alerts Dashboard\n\nTelegram integration is working correctly!",
          { botToken, chatId: targetChatId }
        );
        return NextResponse.json({ 
          success: true, 
          message: "Test message sent successfully",
          result 
        });
      }
    } else {
      // Test connection
      const botToken = telegramSettings.botToken || process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return NextResponse.json({ 
          error: "Telegram bot token not configured",
          success: false 
        }, { status: 400 });
      }
      
      const botInfo = await testTelegramConnection();
      return NextResponse.json({ 
        success: true, 
        message: "Telegram bot connection successful",
        botInfo 
      });
    }
  } catch (e) {
    return NextResponse.json({ 
      error: String(e.message || e),
      success: false 
    }, { status: 500 });
  }
}