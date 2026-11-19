export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors }
    });

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // ---------- SEND OTP ----------
    // login.html calls: POST /api/send-otp  { email, purpose }
    // old code called:  POST /request-otp  { email }
    if ((url.pathname === '/api/send-otp' || url.pathname === '/request-otp') && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const email = (body.email || '').trim().toLowerCase();
        const purpose = body.purpose || 'password_reset';

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json({ success: false, error: 'Invalid email' }, 400);
        }

        if (!env.OTP_KV) return json({ success: false, error: 'KV binding OTP_KV missing' }, 500);
        if (!env.RESEND_API_KEY) return json({ success: false, error: 'RESEND_API_KEY missing' }, 500);

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Save with purpose so signup / reset don't clash
        await env.OTP_KV.put(`otp:${purpose}:${email}`, otp, { expirationTtl: 600 });
        // Also save legacy key for backwards compatibility
        await env.OTP_KV.put(`otp:${email}`, otp, { expirationTtl: 600 });

        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Zono <onboarding@resend.dev>',
            to: [email],
            subject: 'Your Zono password reset code',
            html: `
              <div style="font-family:Arial,sans-serif;padding:24px;background:#050507;color:#fff;border-radius:12px">
                <h2 style="color:#ccff00;margin:0 0 12px">ZONO</h2>
                <p style="font-size:16px">Your password reset code is:</p>
                <div style="font-size:32px;font-weight:900;letter-spacing:8px;color:#ccff00;margin:16px 0">${otp}</div>
                <p style="color:#aaa;font-size:14px">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
              </div>
            `,
            text: `Your Zono password reset code is: ${otp}\n\nThis code expires in 10 minutes. If you didn't request this, ignore this email.`
          })
        });

        if (!resendRes.ok) {
          const errText = await resendRes.text();
          console.error('Resend failed:', errText);
          return json({ success: false, error: 'Failed to send email. Check Resend API key / sender.' }, 500);
        }

        return json({ success: true, message: 'OTP sent' });
      } catch (e) {
        console.error(e);
        return json({ success: false, error: 'Server error sending OTP' }, 500);
      }
    }

    // ---------- VERIFY OTP ----------
    // login.html calls: POST /api/verify-otp { email, code, purpose }
    // old code called:  POST /verify-otp     { email, otp }
    if ((url.pathname === '/api/verify-otp' || url.pathname === '/verify-otp') && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const email = (body.email || '').trim().toLowerCase();
        const code = (body.code || body.otp || '').toString().trim();
        const purpose = body.purpose || 'password_reset';

        if (!email || !code) {
          return json({ success: false, error: 'Missing email or code' }, 400);
        }

        if (!env.OTP_KV) return json({ success: false, error: 'KV binding OTP_KV missing' }, 500);

        // Try purpose key first, then legacy key
        let saved = await env.OTP_KV.get(`otp:${purpose}:${email}`);
        if (!saved) saved = await env.OTP_KV.get(`otp:${email}`);

        if (saved && saved === code) {
          await env.OTP_KV.delete(`otp:${purpose}:${email}`);
          await env.OTP_KV.delete(`otp:${email}`);
          return json({ success: true, message: 'Code verified' });
        }

        return json({ success: false, error: 'Invalid or expired code' }, 400);
      } catch (e) {
        console.error(e);
        return json({ success: false, error: 'Server error verifying OTP' }, 500);
      }
    }

    // ---------- Serve your website ----------
    // This serves index.html, login.html, signup.html, etc from your repo
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json({ success: false, error: 'ASSETS binding missing' }, 500);
  }
};
