export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // SEND OTP
    if (url.pathname === '/request-otp' && request.method === 'POST') {
      const { email } = await request.json();
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      await env.OTP_KV.put(`otp:${email}`, otp, { expirationTtl: 600 });
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Zono <onboarding@resend.dev>',
          to: email,
          subject: 'Your Zono password reset code',
          html: `<div style="font-family:Arial;padding:20px"><h2>Your Zono code is: ${otp}</h2><p>Expires in 10 minutes.</p></div>`
        })
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...cors } });
    }

    // VERIFY OTP
    if (url.pathname === '/verify-otp' && request.method === 'POST') {
      const { email, otp } = await request.json();
      const saved = await env.OTP_KV.get(`otp:${email}`);
      if (saved && saved === otp) {
        await env.OTP_KV.delete(`otp:${email}`);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
      return new Response(JSON.stringify({ success: false }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
    }

    // Serve your website like before
    return env.ASSETS.fetch(request);
  }
};
