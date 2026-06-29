# Telegram Bot Setup Guide

Follow these steps to set up Telegram alerts with chart images for your Engulfing Dashboard:

## Step 1: Create a Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Start a conversation with BotFather
3. Send `/newbot` command
4. Choose a name for your bot (e.g., "My Engulfing Alerts Bot")
5. Choose a username for your bot (must end with 'bot', e.g., "myengulfing_alerts_bot")
6. BotFather will provide you with a **Bot Token** - save this token!

## Step 2: Get Your Chat ID

### Option A: Personal Chat
1. Start a conversation with your newly created bot
2. Send any message to the bot
3. Open this URL in your browser (replace `YOUR_BOT_TOKEN` with your actual token):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
4. Look for `"chat":{"id":XXXXXXXXX` - this number is your Chat ID

### Option B: Using @userinfobot
1. Search for `@userinfobot` on Telegram
2. Start a conversation and send `/start`
3. The bot will reply with your Chat ID

### Option C: Group Chat
1. Add your bot to a group
2. Make sure the bot has permission to read messages
3. Send a message in the group mentioning your bot
4. Use the getUpdates URL method above to find the group chat ID (it will be negative)

## Step 3: Configure in Dashboard

1. Login to your Engulfing Dashboard
2. Scroll down to the **Settings** section
3. Find **Telegram alerts** section
4. Enter your **Bot Token** from Step 1
5. Enter your **Chat ID** from Step 2
6. Click **Send test message** to verify text messaging
7. Click **Test chart image** to verify image functionality
8. Click **Save** to save your configuration

## Step 4: Test the Setup

1. After saving your configuration, use both test buttons:
   - **Send test message**: Tests basic text messaging
   - **Test chart image**: Tests chart image functionality
2. You should receive both a text message and a chart image in your Telegram chat
3. If successful, you'll now receive Telegram alerts with chart images when engulfing patterns are detected!

## Chart Image Features

📊 **What you'll receive:**
- **High-quality chart images** (PNG format, 800x600 pixels)
- **Highlighted engulfing patterns** with visual markers
- **Price levels** clearly marked on the chart
- **Signal candle** highlighted and annotated
- **Full trade details** in the image caption
- **Automatic fallback** to text-only if image fails

🎨 **Chart highlights include:**
- Green/red candles for bullish/bearish patterns
- Level zones clearly marked
- Signal timestamps
- OHLC data for analysis

## Troubleshooting

### "Bot token not configured" error
- Make sure you've entered the correct bot token from @BotFather
- The token should look like: `123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ`

### "Chat ID not configured" error
- Ensure you've entered the correct Chat ID
- Personal chat IDs are positive numbers
- Group chat IDs are negative numbers

### "Telegram API error" messages
- Check if your bot token is valid
- Make sure you've started a conversation with your bot (for personal chats)
- For group chats, ensure the bot is added and has message permissions

### Messages not being received
- Verify the Chat ID is correct
- Check if you've blocked the bot
- For group chats, make sure the bot wasn't removed

## Message Format

**Text + Chart Image:**
- 📊 **High-quality PNG chart image** showing the engulfing pattern
- 🟢/🔴 **Direction indicator** (Bullish/Bearish) in caption
- **Pair and exchange** information
- **Price level range** clearly marked
- **Candle timestamp** (UTC)
- **OHLC data** for both signal and previous candles
- **Position sizing information** (if configured)
- **Direct link** to TradingView chart

**Image Features:**
- 800x600 pixel resolution for clarity
- Highlighted engulfing candle
- Level zones marked on chart
- Professional chart styling
- Automatic fallback to SVG document if PNG conversion fails

## Troubleshooting

### "Bot token not configured" error
- Make sure you've entered the correct bot token from @BotFather
- The token should look like: `123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ`

### "Chat ID not configured" error
- Ensure you've entered the correct Chat ID
- Personal chat IDs are positive numbers
- Group chat IDs are negative numbers

### "Telegram API error" messages
- Check if your bot token is valid
- Make sure you've started a conversation with your bot (for personal chats)
- For group chats, ensure the bot is added and has message permissions

### Messages not being received
- Verify the Chat ID is correct
- Check if you've blocked the bot
- For group chats, make sure the bot wasn't removed

### Chart images not appearing
- Test using the "Test chart image" button first
- If PNG images fail, the system will automatically send SVG files
- Check if your bot has permission to send photos
- Large images might take longer to process and send

### "Image failed, text sent" in alerts page
- This indicates the image couldn't be sent but text was delivered
- Usually due to temporary API issues or file size limits
- The alert still contains all necessary information

## Security Notes

- Keep your bot token secure - don't share it publicly
- Your bot token is stored in your dashboard settings (not in environment variables)
- You can revoke and regenerate bot tokens anytime via @BotFather
- Chart images are generated on-demand and not stored permanently