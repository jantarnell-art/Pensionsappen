// api/webhook.js — tar emot bekräftelse från Stripe
// och uppdaterar användarens pro-status i Supabase
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(Buffer.from(body)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe    = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase  = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY  // service role key — bara i Vercel!
  );

  const rawBody = await getRawBody(req);
  const sig     = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Betalning klar → aktivera Pro
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId  = session.metadata?.userId;

    if (userId) {
      const { error } = await supabase
        .from('profiles')
        .update({
          is_pro: true,
          pro_since: new Date().toISOString(),
          stripe_customer: session.customer,
        })
        .eq('user_id', userId);

      if (error) console.error('Supabase update error:', error);
      else console.log(`✅ Pro aktiverat för user: ${userId}`);
    }
  }

  // Prenumeration avslutas → ta bort Pro
  if (event.type === 'customer.subscription.deleted') {
    const customerId = event.data.object.customer;
    await supabase
      .from('profiles')
      .update({ is_pro: false })
      .eq('stripe_customer', customerId);
    console.log(`❌ Pro avaktiverat för customer: ${customerId}`);
  }

  res.status(200).json({ received: true });
}
