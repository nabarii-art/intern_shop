import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'my_super_secret_whatsapp_token_123';
const APP_SECRET = process.env.META_APP_SECRET;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Middleware to capture the raw body for Meta signature verification
app.use(express.json({
  verify: (req: any, res: any, buf: Buffer) => {
    req.rawBody = buf;
  }
}));

// Root Endpoint
app.get('/', (req: Request, res: Response) => {
  res.send('Welcome to Intern WhatsApp Shop API');
});

// Health Check Endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    application: 'Intern WhatsApp Shop'
  });
});

// ==========================================
// Helper Function: Send WhatsApp Message
// ==========================================
async function sendWhatsAppMessage(recipientPhone: string, messageText: string) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error('Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment variables.');
    return;
  }

  try {
    const url = `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipientPhone,
        text: { body: messageText },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Failed to send WhatsApp message:', errorData);
    } else {
      console.log(`[OUTBOUND] Sent message to ${recipientPhone}`);
    }
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
  }
}

// ==========================================
// Webhook Verification Endpoint (GET)
// ==========================================
app.get('/webhooks/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully by Meta!');
    return res.status(200).send(challenge);
  }

  console.warn('Webhook verification failed: Token mismatch.');
  return res.sendStatus(403);
});

// ==========================================
// Webhook Event Receiver Endpoint (POST)
// ==========================================
app.post('/webhooks/whatsapp', async (req: any, res: Response) => {
  const signatureHeader = req.headers['x-hub-signature-256'];

  if (APP_SECRET && signatureHeader) {
    const expectedSignature = `sha256=${crypto
      .createHmac('sha256', APP_SECRET)
      .update(req.rawBody)
      .digest('hex')}`;

    if (signatureHeader !== expectedSignature) {
      console.warn('Invalid signature received.');
      return res.sendStatus(403);
    }
  }

  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        // Handle incoming customer messages
        if (change.value?.messages) {
          for (const msg of change.value.messages) {
            const senderPhone = msg.from;
            const messageText = msg.text?.body?.trim().toLowerCase() || '';

            console.log(`[MESSAGE] From: ${senderPhone} | Text: "${msg.text?.body}"`);

            let replyText = '';

            // Decision Logic (Rules 1-6)
            if (messageText === 'hello' || messageText === 'hi') {
              replyText = 
                'Welcome to Intern WhatsApp Shop! 🛍️\n\n' +
                'Please reply with a number:\n' +
                '1. View Products\n' +
                '2. Create Order\n' +
                '3. Check Order Status\n' +
                '4. Help';
            } else if (messageText === '1') {
              replyText = 
                'Available Products:\n\n' +
                '1. T-Shirt - $20\n' +
                '2. Cap - $15\n' +
                '3. Mug - $10';
            } else if (messageText === '2') {
              replyText = 'To create an order, please reply with the item name and your delivery address (e.g., T-Shirt, 123 Main St).';
            } else if (messageText === '3') {
              replyText = 'To check your order status, please reply with your Order ID.';
            } else if (messageText === '4') {
              replyText = "Help Menu: You can view products by sending '1', place orders by sending '2', or type 'Hello' anytime to see the main menu.";
            } else {
              replyText = 'Sorry, I did not understand your selection. Please send Hello to view the menu.';
            }

            // Automatically reply back to the customer
            await sendWhatsAppMessage(senderPhone, replyText);
          }
        }

        // Handle delivery status updates
        if (change.value?.statuses) {
          for (const status of change.value.statuses) {
            console.log(`[STATUS] Message ID ${status.id} status: ${status.status}`);
          }
        }
      }
    }

    return res.sendStatus(200);
  }

  return res.sendStatus(404);
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});