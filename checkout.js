import Stripe from 'stripe';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.VITE_STRIPE_PRICE, quantity: 1 }],
      customer_email: req.body?.email,
      success_url: `${process.env.VITE_APP_URL}?success=true`,
      cancel_url:  `${process.env.VITE_APP_URL}?cancelled=true`,
    });
    res.status(200).json({ url: session.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
}
