import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verifyToken } from '@clerk/backend';

// ── Types ────────────────────────────────────────────────────────────────────
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<void>;
}

interface R2Bucket {
  get(key: string): Promise<{ body: ReadableStream; size: number; httpMetadata?: { contentType?: string } } | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }): Promise<void>;
  list(options?: { prefix?: string }): Promise<{ objects: { key: string; size: number; uploaded: string }[] }>;
}

type Env = {
  DB: D1Database;
  RELEASES: R2Bucket;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
  LICENSE_HMAC_SECRET: string;
  CLAUDE_API_KEY_FOR_CUSTOMERS?: string;
  OPENROUTER_KEYS?: string;
  ENVIRONMENT?: string;
};

const ADMIN_EMAILS = ['steve@3dhub.au', 'steve@pennywiseit.com.au'];

// Pricing — must match landing page (autohue/src/app/page.tsx)
const TIERS: Record<string, { name: string; dailyLimit: number; monthlyPrice: number; yearlyPrice: number }> = {
  trial:     { name: 'Trial',     dailyLimit: 50,     monthlyPrice: 0,   yearlyPrice: 0 },
  hobbyist:  { name: 'Hobbyist',  dailyLimit: 300,    monthlyPrice: 24,  yearlyPrice: 19 },
  pro:       { name: 'Pro',       dailyLimit: 2000,   monthlyPrice: 99,  yearlyPrice: 79 },
  unlimited: { name: 'Unlimited', dailyLimit: 10000,  monthlyPrice: 249, yearlyPrice: 199 },
};

const TIER_CODES: Record<string, string> = {
  trial: 'TRL', hobbyist: 'HOB', pro: 'PRO', unlimited: 'UNL',
};

const app = new Hono<{ Bindings: Env }>();

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return 'https://autohue.app';
    const allowed = [
      'http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174',
      'https://autohue.app', 'https://admin.autohue.app',
      'https://autohue.pages.dev',
    ];
    if (allowed.includes(origin)) return origin;
    if (origin.endsWith('.pages.dev')) return origin;
    return 'https://autohue.app';
  },
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['POST', 'GET', 'PUT', 'DELETE', 'OPTIONS'],
}));

// ── Auth helper — verify Clerk JWT, return email ─────────────────────────────
async function getAdminEmail(req: Request, secretKey: string, jwtKey?: string): Promise<string | null> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  try {
    const normalizedKey = jwtKey?.replace(/\\n/g, '\n');
    const opts: Record<string, string> = normalizedKey
      ? { jwtKey: normalizedKey, secretKey }
      : { secretKey };
    const payload = await verifyToken(token, opts as any) as any;

    // Try to get email directly from JWT claims
    let email = payload?.email || payload?.email_addresses?.[0]?.email_address;

    // If email not in JWT, look up the user via Clerk Backend API
    if (!email && payload?.sub) {
      try {
        const userRes = await fetch(`https://api.clerk.com/v1/users/${payload.sub}`, {
          headers: { 'Authorization': `Bearer ${secretKey}` },
        });
        if (userRes.ok) {
          const userData = await userRes.json() as any;
          const primaryEmailId = userData.primary_email_address_id;
          const emailObj = userData.email_addresses?.find((e: any) => e.id === primaryEmailId);
          email = emailObj?.email_address || userData.email_addresses?.[0]?.email_address;
        }
      } catch (e) {
        console.error('[auth] Clerk user lookup failed:', String(e));
      }
    }

    console.log('[auth] Resolved email:', email, 'from sub:', payload?.sub);
    if (!email || !ADMIN_EMAILS.includes(email)) return null;
    return email;
  } catch (e) {
    console.error('[auth] verifyToken failed:', String(e));
    return null;
  }
}

// ── License key generation ───────────────────────────────────────────────────
async function generateLicenseKey(tier: string, secret: string): Promise<string> {
  const tierCode = TIER_CODES[tier] || 'TRL';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let random = '';
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 16; i++) random += chars[arr[i] % chars.length];
  const grouped = random.match(/.{4}/g)!.join('-');

  // HMAC checksum (last 4 chars)
  const data = new TextEncoder().encode(`${tierCode}-${grouped}`);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  const check = hex.slice(0, 4).toUpperCase();

  return `AH-${tierCode}-${grouped}-${check}`;
}

// ── PayPal helpers ───────────────────────────────────────────────────────────
async function getPayPalToken(clientId: string, clientSecret: string): Promise<string | null> {
  const base = 'https://api-m.paypal.com';
  try {
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const data = await res.json<{ access_token?: string }>();
    return data.access_token || null;
  } catch { return null; }
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ ok: true, service: 'autohue-api' }));

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC: License Validation (called by desktop app)
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/license/validate', async (c) => {
  const body = await c.req.json<{ key: string; machineId: string; appVersion?: string }>();
  const { key, machineId, appVersion } = body;

  if (!key || !machineId) {
    return c.json({ valid: false, error: 'key and machineId required' }, 400);
  }

  const customer = await c.env.DB.prepare(
    'SELECT * FROM customers WHERE license_key = ?'
  ).bind(key).first<any>();

  if (!customer) {
    await logValidation(c.env.DB, null, machineId, appVersion, 'invalid_key', c.req.header('CF-Connecting-IP'));
    return c.json({ valid: false, error: 'Invalid license key' });
  }

  if (!customer.is_active) {
    await logValidation(c.env.DB, customer.id, machineId, appVersion, 'revoked', c.req.header('CF-Connecting-IP'));
    return c.json({ valid: false, error: 'License has been revoked' });
  }

  // Check subscription status — if cancelled, reject
  if (customer.subscription_status === 'cancelled') {
    await logValidation(c.env.DB, customer.id, machineId, appVersion, 'subscription_cancelled', c.req.header('CF-Connecting-IP'));
    return c.json({ valid: false, error: 'Subscription cancelled' });
  }

  // Check trial expiry
  if (customer.expires_at && new Date(customer.expires_at) < new Date()) {
    await logValidation(c.env.DB, customer.id, machineId, appVersion, 'expired', c.req.header('CF-Connecting-IP'));
    return c.json({ valid: false, error: 'License has expired', tier: customer.tier });
  }

  // Check machine slots — kick oldest machine if a 3rd tries to activate
  if (customer.machine_id && customer.machine_id !== machineId) {
    const machines = customer.machine_id.split(',');
    if (!machines.includes(machineId)) {
      if (machines.length >= customer.machine_slots) {
        // Kick the OLDEST machine (first in the list) to make room
        machines.shift();
      }
      // Add new machine
      machines.push(machineId);
      await c.env.DB.prepare(
        'UPDATE customers SET machine_id = ?, machines_used = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind(machines.join(','), machines.length, customer.id).run();
    }
  } else if (!customer.machine_id) {
    // First activation
    await c.env.DB.prepare(
      'UPDATE customers SET machine_id = ?, machines_used = 1, activated_at = datetime("now"), updated_at = datetime("now") WHERE id = ?'
    ).bind(machineId, customer.id).run();
  }

  // Update last_validated
  await c.env.DB.prepare(
    'UPDATE customers SET last_validated = datetime("now"), updated_at = datetime("now") WHERE id = ?'
  ).bind(customer.id).run();

  await logValidation(c.env.DB, customer.id, machineId, appVersion, 'valid', c.req.header('CF-Connecting-IP'));

  const tier = TIERS[customer.tier] || TIERS.trial;

  // Include Claude API key for ALL tiers (trial gets same accuracy, just limited daily count)
  // This ensures trial users see the real product quality and are motivated to upgrade
  const claudeApiKey = c.env.CLAUDE_API_KEY_FOR_CUSTOMERS || undefined;

  return c.json({
    valid: true,
    tier: customer.tier,
    dailyLimit: tier.dailyLimit,
    bonusQuota: (customer as any).bonus_quota || 0,
    expiresAt: customer.expires_at,
    machineSlots: customer.machine_slots,
    machinesUsed: customer.machines_used,
    activatedAt: customer.activated_at,
    subscription_status: customer.subscription_status || 'active',
    ...(claudeApiKey ? { claudeApiKey } : {}),
  });
});

async function logValidation(db: D1Database, customerId: number | null, machineId: string, appVersion: string | undefined, result: string, ip: string | undefined) {
  try {
    await db.prepare(
      'INSERT INTO validations (customer_id, machine_id, app_version, ip_address, result) VALUES (?, ?, ?, ?, ?)'
    ).bind(customerId, machineId, appVersion || null, ip || null, result).run();
  } catch (e) {
    console.error('[validation log] failed:', String(e));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC: PayPal Checkout (called by purchase page)
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/paypal/create-subscription', async (c) => {
  const { tier, billing, email, planId, returnUrl, cancelUrl } = await c.req.json<{ tier: string; billing?: string; email: string; planId: string; returnUrl?: string; cancelUrl?: string }>();
  const tierInfo = TIERS[tier];
  const isYearly = billing === 'yearly';
  const price = isYearly ? tierInfo?.yearlyPrice : tierInfo?.monthlyPrice;
  if (!tierInfo || price === 0 || price === undefined) {
    return c.json({ error: 'Invalid tier' }, 400);
  }
  if (!email) return c.json({ error: 'Email required' }, 400);
  if (!planId) return c.json({ error: 'PayPal Plan ID required' }, 400);

  const token = await getPayPalToken(c.env.PAYPAL_CLIENT_ID, c.env.PAYPAL_CLIENT_SECRET);
  if (!token) return c.json({ error: 'PayPal auth failed' }, 500);

  const res = await fetch('https://api-m.paypal.com/v1/billing/subscriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plan_id: planId,
      custom_id: JSON.stringify({ tier, email }),
      application_context: {
        brand_name: 'AutoHue',
        landing_page: 'NO_PREFERENCE',
        user_action: 'SUBSCRIBE_NOW',
        return_url: returnUrl || 'https://autohue.app/checkout/success',
        cancel_url: cancelUrl || 'https://autohue.app/checkout/cancel',
      },
    }),
  });

  const subscription = await res.json<{ id: string; status: string; links?: { href: string; rel: string }[] }>();
  const approveLink = subscription.links?.find((l: any) => l.rel === 'approve')?.href;
  return c.json({ subscriptionId: subscription.id, approveUrl: approveLink });
});

app.post('/api/paypal/activate-subscription', async (c) => {
  const { subscriptionId, email } = await c.req.json<{ subscriptionId: string; email: string }>();
  if (!subscriptionId || !email) return c.json({ error: 'subscriptionId and email required' }, 400);

  const token = await getPayPalToken(c.env.PAYPAL_CLIENT_ID, c.env.PAYPAL_CLIENT_SECRET);
  if (!token) return c.json({ error: 'PayPal auth failed' }, 500);

  // Get subscription details from PayPal
  const res = await fetch(`https://api-m.paypal.com/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  const sub = await res.json<any>();
  if (sub.status !== 'ACTIVE' && sub.status !== 'APPROVED') {
    return c.json({ error: 'Subscription not active', status: sub.status }, 400);
  }

  // Extract tier from custom_id
  let tier = 'hobbyist';
  try {
    const parsed = JSON.parse(sub.custom_id || '{}');
    tier = parsed.tier || 'hobbyist';
  } catch {}

  const payerId = sub.subscriber?.payer_id;
  const payerEmail = sub.subscriber?.email_address || email;

  // Generate license key
  const licenseKey = await generateLicenseKey(tier, c.env.LICENSE_HMAC_SECRET);

  // Create or update customer
  const existing = await c.env.DB.prepare(
    'SELECT id FROM customers WHERE email = ?'
  ).bind(email.toLowerCase()).first<{ id: number }>();

  let customerId: number;
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE customers SET tier = ?, license_key = ?, is_active = 1, machine_id = NULL, machines_used = 0,
       expires_at = NULL, paypal_subscription_id = ?, subscription_status = 'active',
       subscription_plan_id = ?, updated_at = datetime("now") WHERE id = ?`
    ).bind(tier, licenseKey, subscriptionId, sub.plan_id || null, existing.id).run();
    customerId = existing.id;
  } else {
    const result = await c.env.DB.prepare(
      `INSERT INTO customers (email, tier, license_key, paypal_subscription_id, subscription_status, subscription_plan_id)
       VALUES (?, ?, ?, ?, 'active', ?)`
    ).bind(email.toLowerCase(), tier, licenseKey, subscriptionId, sub.plan_id || null).run();
    customerId = result.meta.changes > 0 ? (await c.env.DB.prepare('SELECT last_insert_rowid() as id').first<{ id: number }>())?.id || 0 : 0;
  }

  // Record payment
  await c.env.DB.prepare(
    'INSERT INTO payments (customer_id, paypal_order_id, paypal_payer_id, paypal_payer_email, amount_usd, tier) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(customerId, subscriptionId, payerId, payerEmail, price || 0, tier).run();

  // Send license key via email
  if (c.env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'AutoHue <no-reply@autohue.app>',
          to: [email],
          subject: `Your AutoHue ${TIERS[tier].name} License Key`,
          html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; background: #111; color: #eee; padding: 32px; border-radius: 16px;">
              <h1 style="color: #ef4444; margin: 0 0 8px;">AutoHue</h1>
              <p>Thanks for subscribing! Here's your <strong>${TIERS[tier].name}</strong> license key:</p>
              <div style="background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin: 16px 0; font-family: monospace; font-size: 18px; text-align: center; letter-spacing: 2px; color: #ef4444;">
                ${licenseKey}
              </div>
              <p style="color: #888; font-size: 14px;">Paste this key into AutoHue Desktop to activate your license. You can activate on up to 2 machines.</p>
              <p style="color: #888; font-size: 14px;">Daily limit: <strong>${TIERS[tier].dailyLimit === -1 ? 'Unlimited' : TIERS[tier].dailyLimit + ' images'}</strong></p>
              <p style="color: #888; font-size: 14px;">Your subscription renews ${isYearly ? 'yearly' : 'monthly'} at $${price}/mo${isYearly ? ' (billed annually)' : ''}.</p>
              <hr style="border: none; border-top: 1px solid #333; margin: 24px 0;" />
              <p style="color: #555; font-size: 12px;">AutoHue — AI Car Photo Color Sorter</p>
            </div>
          `,
        }),
      });
    } catch (e) {
      console.error('[email] failed to send license key:', String(e));
    }
  }

  return c.json({
    success: true,
    licenseKey,
    tier,
    tierName: TIERS[tier].name,
    email,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC: PayPal Webhook (subscription lifecycle events)
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/paypal-webhook', async (c) => {
  const body = await c.req.json<any>();
  const eventType = body.event_type;
  const resource = body.resource;

  console.log(`[paypal-webhook] event_type=${eventType}`);

  if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
    const subscriptionId = resource?.id;
    let tier = 'hobbyist';
    let email: string | null = null;
    try {
      const parsed = JSON.parse(resource?.custom_id || '{}');
      tier = parsed.tier || 'hobbyist';
      email = parsed.email || null;
    } catch {}

    const paypalCustomerId = resource?.subscriber?.payer_id || null;

    // Insert into pending_activations for the activate-subscription endpoint to consume
    await c.env.DB.prepare(
      `INSERT INTO pending_activations (plan, email, paypal_subscription_id, paypal_customer_id) VALUES (?, ?, ?, ?)`
    ).bind(tier, email, subscriptionId, paypalCustomerId).run();

    // Also directly update customer if they already exist
    if (email) {
      await c.env.DB.prepare(
        `UPDATE customers SET subscription_status = 'active', paypal_subscription_id = ?, updated_at = datetime("now") WHERE email = ?`
      ).bind(subscriptionId, email.toLowerCase()).run();
    }

    return c.json({ received: true });
  }

  if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
    const subscriptionId = resource?.id;
    let email: string | null = null;
    try {
      const parsed = JSON.parse(resource?.custom_id || '{}');
      email = parsed.email || null;
    } catch {}

    // Insert into pending_cancellations
    await c.env.DB.prepare(
      `INSERT INTO pending_cancellations (email, paypal_subscription_id) VALUES (?, ?)`
    ).bind(email, subscriptionId).run();

    // Deactivate the customer's subscription
    await c.env.DB.prepare(
      `UPDATE customers SET subscription_status = 'cancelled', updated_at = datetime("now") WHERE paypal_subscription_id = ?`
    ).bind(subscriptionId).run();

    return c.json({ received: true });
  }

  // Unhandled event type — acknowledge receipt
  return c.json({ received: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC: License Lookup (called by autohue.app dashboard)
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/license/lookup', async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  if (!email) return c.json({ error: 'email required' }, 400);

  const customer = await c.env.DB.prepare(
    'SELECT tier, license_key, subscription_status, expires_at, machine_slots, machines_used, is_active FROM customers WHERE email = ? AND is_active = 1'
  ).bind(email.toLowerCase()).first<any>();

  if (!customer) return c.json({ found: false });

  return c.json({
    found: true,
    licenseKey: customer.license_key,
    tier: customer.tier,
    tierName: TIERS[customer.tier]?.name || customer.tier,
    subscriptionStatus: customer.subscription_status || 'active',
    expiresAt: customer.expires_at,
    machineSlots: customer.machine_slots,
    machinesUsed: customer.machines_used,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: Dashboard Analytics
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/dashboard', async (c) => {
  const admin = await getAdminEmail(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY);
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const [
    totalCustomers,
    tierCounts,
    totalRevenue,
    revenueThisMonth,
    recentValidations,
    newCustomersThisWeek,
  ] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM customers').first<{ count: number }>(),
    c.env.DB.prepare('SELECT tier, COUNT(*) as count FROM customers GROUP BY tier').all<{ tier: string; count: number }>(),
    c.env.DB.prepare('SELECT COALESCE(SUM(amount_usd), 0) as total FROM payments WHERE status = "completed"').first<{ total: number }>(),
    c.env.DB.prepare('SELECT COALESCE(SUM(amount_usd), 0) as total FROM payments WHERE status = "completed" AND created_at >= datetime("now", "-30 days")').first<{ total: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM validations WHERE created_at >= datetime("now", "-24 hours")').first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM customers WHERE created_at >= datetime("now", "-7 days")').first<{ count: number }>(),
  ]);

  return c.json({
    totalCustomers: totalCustomers?.count || 0,
    tierBreakdown: tierCounts?.results || [],
    totalRevenue: totalRevenue?.total || 0,
    revenueThisMonth: revenueThisMonth?.total || 0,
    validationsLast24h: recentValidations?.count || 0,
    newCustomersThisWeek: newCustomersThisWeek?.count || 0,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: Customers CRUD
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/customers', async (c) => {
  const admin = await getAdminEmail(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY);
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const search = c.req.query('search') || '';
  const page = parseInt(c.req.query('page') || '1');
  const limit = 50;
  const offset = (page - 1) * limit;

  let rows, total;
  if (search) {
    const q = `%${search}%`;
    rows = await c.env.DB.prepare(
      'SELECT * FROM customers WHERE email LIKE ? OR name LIKE ? OR license_key LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(q, q, q, limit, offset).all<any>();
    total = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM customers WHERE email LIKE ? OR name LIKE ? OR license_key LIKE ?'
    ).bind(q, q, q).first<{ count: number }>();
  } else {
    rows = await c.env.DB.prepare(
      'SELECT * FROM customers ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(limit, offset).all<any>();
    total = await c.env.DB.prepare('SELECT COUNT(*) as count FROM customers').first<{ count: number }>();
  }

  return c.json({
    customers: rows?.results || [],
    total: total?.count || 0,
    page,
    pages: Math.ceil((total?.count || 0) / limit),
  });
});

app.get('/api/admin/customers/:id', async (c) => {
  const admin = await getAdminEmail(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY);
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const customer = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  if (!customer) return c.json({ error: 'Not found' }, 404);

  const payments = await c.env.DB.prepare(
    'SELECT * FROM payments WHERE customer_id = ? ORDER BY created_at DESC'
  ).bind(id).all();

  const validations = await c.env.DB.prepare(
    'SELECT * FROM validations WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(id).all();

  return c.json({ customer, payments: payments?.results || [], validations: validations?.results || [] });
});

app.put('/api/admin/customers/:id', async (c) => {
  const admin = await getAdminEmail(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY);
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const body = await c.req.json<{ tier?: string; name?: string; notes?: string; is_active?: boolean }>();

  const sets: string[] = ['updated_at = datetime("now")'];
  const vals: unknown[] = [];

  if (body.tier !== undefined) { sets.push('tier = ?'); vals.push(body.tier); }
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
  if (body.notes !== undefined) { sets.push('notes = ?'); vals.push(body.notes); }
  if (body.is_active !== undefined) { sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); }

  vals.push(id);
  await c.env.DB.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (admin_email, action, target_id, details) VALUES (?, ?, ?, ?)'
  ).bind(admin, 'edited_customer', parseInt(id), JSON.stringify(body)).run();

  return c.json({ success: true });
});

app.delete('/api/admin/customers/:id', async (c) => {
  const admin = await getAdminEmail(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY);
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM customers WHERE id = ?').bind(id).run();

  await c.env.DB.prepare(
    'INSERT INTO audit_log (admin_email, action, target_id) VALUES (?, ?, ?)'
  ).bind(admin, 'deleted_customer', parseInt(id)).run();

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: License Management
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/admin/licenses/generate', async (c) => {
  const admin = await getAdminEmail(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY);
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const { tier, email, notes } = await c.req.json<{ tier: string; email?: string; notes?: string }>();
  if (!TIERS[tier]) return c.json({ error: 'Invalid tier' }, 400);

  const licenseKey = await generateLicenseKey(tier, c.env.LICENSE_HMAC_SECRET);

  const expiresAt = tier === 'trial'
    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  if (email) {
    // Create customer with this key
    const existing = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(email.toLowerCase()).first<{ id: number }>();
    if (existing) {
      await c.env.DB.prepare(
        'UPDATE customers SET tier = ?, license_key = ?, is_active = 1, expires_at = ?, notes = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind(tier, licenseKey, expiresAt, notes || null, existing.id).run();
    } else {
      await c.env.DB.prepare(
        'INSERT INTO customers (email, tier, license_key, expires_at, notes) VALUES (?, ?, ?, ?, ?)'
      ).bind(email.toLowerCase(), tier, licenseKey, expiresAt, notes || null).run();
    }
  } else {
    // Unassigned key — create a placeholder customer
    await c.env.DB.prepare(
      'INSERT INTO customers (email, tier, license_key, expires_at, notes) VALUES (?, ?, ?, ?, ?)'
    ).bind(`unassigned-${Date.now()}@autohue.app`, tier, licenseKey, expiresAt, notes || 'Unassigned key').run();
  }

  await c.env.DB.prepare(
    'INSERT INTO audit_log (admin_email, action, details) VALUES (?, ?, ?)'
  ).bind(admin, 'generated_license', JSON.stringify({ tier, email, licenseKey })).run();

  return c.json({ success: true, licenseKey, tier, email });
});

app.post('/api/admin/licenses/revoke/:id', async (c) => {
  const admin = await getAdminEmail(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY);
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  await c.env.DB.prepare(
    'UPDATE customers SET is_active = 0, updated_at = datetime("now") WHERE id = ?'
  ).bind(id).run();

  await c.env.DB.prepare(
    'INSERT INTO audit_log (admin_email, action, target_id) VALUES (?, ?, ?)'
  ).bind(admin, 'revoked_license', parseInt(id)).run();

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: Payments
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/payments', async (c) => {
  const admin = await getAdminEmail(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY);
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const page = parseInt(c.req.query('page') || '1');
  const limit = 50;
  const offset = (page - 1) * limit;

  const rows = await c.env.DB.prepare(
    `SELECT p.*, c.email as customer_email, c.name as customer_name
     FROM payments p LEFT JOIN customers c ON p.customer_id = c.id
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all<any>();

  const total = await c.env.DB.prepare('SELECT COUNT(*) as count FROM payments').first<{ count: number }>();

  return c.json({
    payments: rows?.results || [],
    total: total?.count || 0,
    page,
    pages: Math.ceil((total?.count || 0) / limit),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: Validation Log
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/validations', async (c) => {
  const admin = await getAdminEmail(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY);
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const rows = await c.env.DB.prepare(
    `SELECT v.*, c.email as customer_email, c.tier as customer_tier
     FROM validations v LEFT JOIN customers c ON v.customer_id = c.id
     ORDER BY v.created_at DESC LIMIT 100`
  ).all<any>();

  return c.json({ validations: rows?.results || [] });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Download endpoint — serves installer files from R2
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/download/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!filename || !/^AutoHue[A-Za-z0-9._-]+\.(exe|dmg|zip)$/i.test(filename)) {
    return c.json({ error: 'Invalid filename' }, 400);
  }

  const object = await c.env.RELEASES.get(filename);
  if (!object) {
    return c.json({ error: 'File not found. Check back soon — new builds are published regularly.' }, 404);
  }

  const contentType = filename.endsWith('.exe') ? 'application/x-msdownload'
    : filename.endsWith('.dmg') ? 'application/x-apple-diskimage'
    : 'application/octet-stream';

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(object.size),
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// Get latest release info (version + file details for each platform)
app.get('/api/releases/latest', async (c) => {
  try {
    const list = await c.env.RELEASES.list();
    const files = (list.objects || []).sort((a: any, b: any) => {
      const ta = new Date(a.uploaded).getTime();
      const tb = new Date(b.uploaded).getTime();
      return tb - ta;
    });

    const latestExe = files.find((f: any) => f.key.endsWith('.exe'));
    const latestDmg = files.find((f: any) => f.key.endsWith('.dmg'));

    const versionMatch = (latestExe?.key || latestDmg?.key || '').match(/(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : 'latest';

    return c.json({
      version,
      windows: latestExe ? { filename: latestExe.key, size: latestExe.size } : undefined,
      mac: latestDmg ? { filename: latestDmg.key, size: latestDmg.size } : undefined,
    });
  } catch (err: any) {
    return c.json({ error: 'Failed to list releases', detail: err.message }, 500);
  }
});

// Download the latest release for a platform — always serves the newest file
app.get('/api/download/latest/:platform', async (c) => {
  const platform = c.req.param('platform');
  const ext = platform === 'mac' ? '.dmg' : '.exe';

  const list = await c.env.RELEASES.list();
  const files = (list.objects || [])
    .filter((f: any) => f.key.endsWith(ext))
    .sort((a: any, b: any) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime());

  if (files.length === 0) {
    return c.json({ error: `No ${platform} release available yet. Check back soon.` }, 404);
  }

  const latest = files[0];
  const object = await c.env.RELEASES.get(latest.key);
  if (!object) {
    return c.json({ error: 'File not found' }, 404);
  }

  const contentType = ext === '.exe' ? 'application/x-msdownload'
    : 'application/x-apple-diskimage';

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${latest.key}"`,
      'Content-Length': String(object.size),
      'Cache-Control': 'public, max-age=300',
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: Grant bonus quota / free credits to a customer
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/admin/customers/:id/bonus', async (c) => {
  const admin = await getAdminEmail(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY);
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const { bonus_quota, reason } = await c.req.json<{ bonus_quota: number; reason?: string }>();

  if (typeof bonus_quota !== 'number' || bonus_quota < 0) {
    return c.json({ error: 'bonus_quota must be a non-negative number' }, 400);
  }

  // Add bonus_quota column if it doesn't exist (safe migration)
  try {
    await c.env.DB.exec('ALTER TABLE customers ADD COLUMN bonus_quota INTEGER DEFAULT 0');
  } catch { /* column already exists */ }

  await c.env.DB.prepare(
    'UPDATE customers SET bonus_quota = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(bonus_quota, id).run();

  await c.env.DB.prepare(
    'INSERT INTO audit_log (admin_email, action, target_id, details) VALUES (?, ?, ?, ?)'
  ).bind(admin, 'granted_bonus_quota', parseInt(id), JSON.stringify({ bonus_quota, reason })).run();

  return c.json({ success: true, bonus_quota });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: Customer usage stats (daily validation counts, app versions)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/customers/:id/usage', async (c) => {
  const admin = await getAdminEmail(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY);
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');

  const [dailyCounts, recentValidations, appVersions] = await Promise.all([
    c.env.DB.prepare(
      `SELECT date(created_at) as day, COUNT(*) as count
       FROM validations WHERE customer_id = ?
       GROUP BY date(created_at) ORDER BY day DESC LIMIT 30`
    ).bind(id).all<{ day: string; count: number }>(),

    c.env.DB.prepare(
      `SELECT machine_id, app_version, ip_address, result, created_at
       FROM validations WHERE customer_id = ?
       ORDER BY created_at DESC LIMIT 50`
    ).bind(id).all<any>(),

    c.env.DB.prepare(
      `SELECT DISTINCT app_version, MAX(created_at) as last_seen
       FROM validations WHERE customer_id = ? AND app_version IS NOT NULL
       GROUP BY app_version ORDER BY last_seen DESC LIMIT 10`
    ).bind(id).all<{ app_version: string; last_seen: string }>(),
  ]);

  return c.json({
    dailyCounts: dailyCounts?.results || [],
    recentValidations: recentValidations?.results || [],
    appVersions: appVersions?.results || [],
  });
});

// List available releases (admin only)
app.get('/api/admin/releases', async (c) => {
  const admin = await getAdminEmail(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY);
  if (!admin) return c.json({ error: 'Unauthorized' }, 401);

  const list = await c.env.RELEASES.list();
  return c.json({
    files: list.objects.map(o => ({
      name: o.key,
      size: o.size,
      uploaded: o.uploaded,
    })),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC: Credit pack purchase (called from checkout page after PayPal payment)
// ═══════════════════════════════════════════════════════════════════════════════

const CREDIT_PACKS: Record<string, { images: number; price: number }> = {
  '500':   { images: 500,   price: 5 },
  '1200':  { images: 1200,  price: 10 },
  '3000':  { images: 3000,  price: 20 },
  '10000': { images: 10000, price: 50 },
};

app.post('/api/credits/purchase', async (c) => {
  const { orderId, pack, images, amount, email } = await c.req.json<{
    orderId: string; pack: string; images: number; amount: string; email: string;
  }>();

  if (!orderId || !pack || !email) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const packInfo = CREDIT_PACKS[pack];
  if (!packInfo) {
    return c.json({ error: 'Invalid credit pack' }, 400);
  }

  // Prevent duplicate processing
  const existing = await c.env.DB.prepare(
    'SELECT id FROM payments WHERE paypal_order_id = ?'
  ).bind(orderId).first<{ id: number }>();
  if (existing) {
    return c.json({ success: true, message: 'Already processed' });
  }

  // Safe migration: add bonus_quota column if missing
  try { await c.env.DB.exec('ALTER TABLE customers ADD COLUMN bonus_quota INTEGER DEFAULT 0'); } catch {}

  // Find or create customer
  let customer = await c.env.DB.prepare(
    'SELECT id, bonus_quota FROM customers WHERE email = ?'
  ).bind(email).first<{ id: number; bonus_quota: number }>();

  if (!customer) {
    // Create a trial customer with bonus credits
    const licenseKey = 'AH-' + crypto.randomUUID().slice(0, 8).toUpperCase();
    await c.env.DB.prepare(
      `INSERT INTO customers (email, tier, license_key, bonus_quota) VALUES (?, 'trial', ?, ?)`
    ).bind(email, licenseKey, packInfo.images).run();
    customer = await c.env.DB.prepare(
      'SELECT id, bonus_quota FROM customers WHERE email = ?'
    ).bind(email).first<{ id: number; bonus_quota: number }>();
  } else {
    // Add credits to existing customer
    const newBonus = (customer.bonus_quota || 0) + packInfo.images;
    await c.env.DB.prepare(
      'UPDATE customers SET bonus_quota = ?, updated_at = datetime("now") WHERE id = ?'
    ).bind(newBonus, customer.id).run();
  }

  // Record payment
  await c.env.DB.prepare(
    `INSERT INTO payments (customer_id, paypal_order_id, paypal_payer_email, amount_usd, tier, status)
     VALUES (?, ?, ?, ?, ?, 'completed')`
  ).bind(customer?.id || null, orderId, email, packInfo.price, 'credits-' + pack).run();

  return c.json({ success: true, creditsAdded: packInfo.images });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: OpenRouter key status (checks credit balances)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/openrouter-status', async (c) => {
  const orKeys = (c.env.OPENROUTER_KEYS || '').split(',').map((k: string) => k.trim()).filter(Boolean);
  if (orKeys.length === 0) {
    return c.json({ keys: [], error: 'No OPENROUTER_KEYS configured' });
  }

  const results = await Promise.all(orKeys.map(async (key: string) => {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      const data = await res.json() as any;
      const usage = data.data?.usage || 0;
      const limit = data.data?.limit || null;
      const remaining = data.data?.limit_remaining || null;
      const label = data.data?.label || '';
      return {
        last6: key.slice(-6),
        label,
        usage,
        limit,
        remaining,
        status: limit !== null && remaining !== null
          ? remaining <= 0 ? 'exhausted' : remaining < 1 ? 'low' : 'ok'
          : usage > 1.5 ? 'low' : 'ok',
      };
    } catch (err: any) {
      return { last6: key.slice(-6), label: '', usage: 0, limit: null, remaining: null, status: 'error', error: err.message };
    }
  }));

  return c.json({ keys: results });
});

export default app;
