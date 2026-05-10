import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const raw = await new Promise((r,j) => {
    let b=''; req.on('data',c=>b+=c); req.on('end',()=>r(Buffer.from(b))); req.on('error',j);
  });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supa   = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  let event;
  try { event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch(e) { return res.status(400).json({ error: e.message }); }
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    await supa.from('profiles').update({ is_pro:true, pro_since:new Date().toISOString(), stripe_customer:s.customer }).eq('user_id', s.client_reference_id);
  }
  if (event.type === 'customer.subscription.deleted')
    await supa.from('profiles').update({ is_pro:false }).eq('stripe_customer', event.data.object.customer);
  res.status(200).json({ received: true });
}
