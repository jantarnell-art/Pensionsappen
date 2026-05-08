// api/checkout.js — Vercel Serverless Function
// Skapar en Stripe Checkout-session och returnerar URL
import Stripe from 'stripe';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { userId, email } = req.body;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.VITE_STRIPE_PRICE,
        quantity: 1,
      }],
      customer_email: email,
      metadata: { userId },
      success_url: `${process.env.VITE_APP_URL || 'http://localhost:5173'}?success=true`,
      cancel_url:  `${process.env.VITE_APP_URL || 'http://localhost:5173'}?cancelled=true`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
 
