const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET, { apiVersion: '2023-10-16' });

module.exports.createCheckout = async ({eventId, ticketTypeId, title, price})=>{
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price_data:{
      currency:'usd',
      unit_amount: Math.round(price*100),
      product_data:{ name: `${title} — General Admission` }
    }, quantity:1 }],
    metadata: { eventId, ticketTypeId },
    success_url: `${process.env.WEB_ORIGIN}/register.html?success=1`,
    cancel_url:  `${process.env.WEB_ORIGIN}/register.html?canceled=1}`,
  });
  return session.url;
}
