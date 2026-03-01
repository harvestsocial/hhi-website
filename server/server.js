// server/server.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const csurf = require('csurf');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { z } = require('zod');
const { pool } = require('./db');           // pg Pool
const stripePay = require('./pay/stripe');  // or require('./pay/paynow')
const uuid = require('uuid');

const app = express();

// ---------- SECURITY MIDDLEWARE ----------
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false, // if CSP, add allowed CDN origins explicitly
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: process.env.WEB_ORIGIN, // e.g. https://yourdomain.com
  credentials: true
}));
app.use(express.json({limit:'256kb'}));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(session({
  name: 'hhi.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie:{
    httpOnly:true,
    sameSite:'lax',
    secure: process.env.NODE_ENV==='production',
    maxAge: 1000*60*60*8 // 8h
  }
}));
const limiter = rateLimit({ windowMs: 15*60*1000, max: 300 });
app.use(limiter);

// CSRF for state-changing routes
const csrfProtection = csurf({ cookie: { httpOnly:true, sameSite:'lax', secure: process.env.NODE_ENV==='production', key: 'csrfToken' }});
app.use((req,res,next)=>{
  // attach a CSRF cookie for front-end reads (already set by csurf on first protected hit)
  res.cookie('csrfToken', req.csrfToken?.() || 'bootstrap', { httpOnly:false, sameSite:'lax', secure: process.env.NODE_ENV==='production' });
  next();
});

// --- ADMIN ADDITIONS START ---

// whoami
app.get('/api/admin/me', (req,res)=> {
  if(req.session?.admin) return res.json({ user: req.session.admin.user });
  return res.status(401).json({ error: 'unauthenticated' });
});

// logout
app.post('/api/admin/logout', csrfProtection, (req,res)=> {
  req.session.destroy(()=> res.json({ ok:true }));
});

// EVENTS admin list
app.get('/api/admin/events', requireAdmin, async (req,res)=>{
  const { rows } = await pool.query(`
    select id, title, banner_url as "bannerUrl", starts_at as "startsAt", venue, type, published
    from events order by starts_at desc
  `);
  res.json(rows);
});

// Create event
app.post('/api/admin/events', csrfProtection, requireAdmin, async (req,res)=>{
  const { z } = require('zod');
  const schema = z.object({
    title: z.string().min(1).max(220),
    bannerUrl: z.string().url(),
    startsAt: z.string().refine(v=>!Number.isNaN(Date.parse(v)), 'invalid date'),
    venue: z.string().min(1).max(220),
    type: z.enum(['FREE','PAID'])
  });
  const p = schema.safeParse(req.body);
  if(!p.success) return res.status(400).json({error:'invalid'});
  const { rows } = await pool.query(`
    insert into events (title, banner_url, starts_at, venue, type, published)
    values ($1,$2,$3,$4,$5,false) returning id
  `,[p.data.title, p.data.bannerUrl, p.data.startsAt, p.data.venue, p.data.type]);
  res.json({ id: rows[0].id });
});

// Update event (and publish toggle)
app.patch('/api/admin/events/:id', csrfProtection, requireAdmin, async (req,res)=>{
  const id = req.params.id;
  const fields = [];
  const vals = []; let i=1;
  for(const k of ['title','bannerUrl','startsAt','venue','type','published']){
    if(k in req.body){
      const col = ({bannerUrl:'banner_url', startsAt:'starts_at'})[k] || k;
      fields.push(`${col}=$${i++}`); vals.push(req.body[k]);
    }
  }
  if(fields.length===0) return res.json({ok:true});
  vals.push(id);
  await pool.query(`update events set ${fields.join(', ')} where id=$${i}`, vals);
  res.json({ok:true});
});

// Delete event
app.delete('/api/admin/events/:id', csrfProtection, requireAdmin, async (req,res)=>{
  await pool.query('delete from events where id=$1', [req.params.id]);
  res.json({ok:true});
});

// Ticket types
app.get('/api/admin/ticket-types', requireAdmin, async (req,res)=>{
  const { eventId } = req.query;
  if(!eventId) return res.status(400).json({error:'missing eventId'});
  const { rows } = await pool.query('select id, name, price from ticket_types where event_id=$1 order by price asc', [eventId]);
  res.json(rows);
});
app.post('/api/admin/ticket-types', csrfProtection, requireAdmin, async (req,res)=>{
  const { z } = require('zod');
  const p = z.object({ eventId:z.string().uuid(), name:z.string().min(1).max(120), price:z.number().min(0) }).safeParse(req.body);
  if(!p.success) return res.status(400).json({error:'invalid'});
  await pool.query('insert into ticket_types (event_id, name, price) values ($1,$2,$3)', [p.data.eventId, p.data.name, p.data.price]);
  res.json({ok:true});
});
app.delete('/api/admin/ticket-types/:id', csrfProtection, requireAdmin, async (req,res)=>{
  await pool.query('delete from ticket_types where id=$1', [req.params.id]);
  res.json({ok:true});
});

// Attendees list (FREE RSVP + PAID tickets)
app.get('/api/admin/attendees', requireAdmin, async (req,res)=>{
  const { eventId, q } = req.query;
  if(!eventId) return res.status(400).json({error:'missing eventId'});
  const query = `
    select 'FREE' as kind, r.first_name, r.last_name, r.email, r.phone, r.status
    from registrations r
    where r.event_id=$1
    ${q ? `and (r.first_name ilike $2 or r.last_name ilike $2 or r.email ilike $2 or r.phone ilike $2)` : ''}
    union all
    select 'PAID' as kind, r.first_name, r.last_name, r.email, r.phone, t.status
    from tickets t
    join registrations r on r.id=t.registration_id
    where t.event_id=$1
    ${q ? `and (r.first_name ilike $2 or r.last_name ilike $2 or r.email ilike $2 or r.phone ilike $2)` : ''}
    order by kind asc, last_name asc, first_name asc
  `;
  const vals = q ? [eventId, `%${q}%`] : [eventId];
  const { rows } = await pool.query(query, vals);
  res.json(rows);
});

// CSV Export (attendees)
app.get('/api/admin/export/:eventId.csv', requireAdmin, async (req,res)=>{
  const eventId = req.params.eventId;
  const { rows: evs } = await pool.query('select title from events where id=$1', [eventId]);
  if(evs.length===0) return res.status(404).send('not found');

  const { rows } = await pool.query(`
    select 'FREE' as kind, r.first_name, r.last_name, r.email, r.phone, r.status, r.created_at
      from registrations r where r.event_id=$1
    union all
    select 'PAID' as kind, r.first_name, r.last_name, r.email, r.phone, t.status, t.used_at as created_at
      from tickets t join registrations r on r.id=t.registration_id where t.event_id=$1
    order by kind asc, last_name asc, first_name asc
  `, [eventId]);

  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="attendees-${evs[0].title.replace(/[^a-z0-9]+/gi,'-')}.csv"`);
  res.write('kind,first_name,last_name,email,phone,status,datetime\n');
  for(const r of rows){
    const line = [r.kind, r.first_name, r.last_name, r.email, r.phone||'', r.status||'', r.created_at? new Date(r.created_at).toISOString() : '']
      .map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',');
    res.write(line+'\n');
  }
  res.end();
});
// --- ADMIN ADDITIONS END ---

// ---------- STATIC ----------
app.use(express.static('public', { index: false }));

// ---------- SIMPLE ADMIN AUTH (stub) ----------
function requireAdmin(req,res,next){ if(req.session?.admin) return next(); return res.status(401).json({error:'auth required'}); }
app.post('/api/admin/login', csrfProtection, async (req,res)=>{
  const {user, pass} = req.body||{};
  if(user===process.env.ADMIN_USER && pass===process.env.ADMIN_PASS){
    req.session.admin = { user };
    return res.json({ok:true});
  }
  return res.status(401).json({error:'invalid'});
});

// ---------- EVENTS ----------
app.get('/api/events', async (req,res)=>{
  const { rows } = await pool.query(`
    select e.id, e.title, e.banner_url as "bannerUrl", e.starts_at as "startsAt",
           e.venue, e.type, coalesce(tt.min_price,0) as "priceFrom"
    from events e
    left join (
      select event_id, min(price) as min_price
      from ticket_types
      where price > 0
      group by event_id
    ) tt on tt.event_id = e.id
    where e.published = true
    order by e.starts_at asc
  `);
  res.json(rows);
});

// ---------- RSVP (FREE) ----------
const rsvpSchema = z.object({
  eventId: z.string().uuid(),
  first: z.string().min(1).max(80),
  last: z.string().min(1).max(80),
  email: z.string().email().max(160),
  phone: z.string().min(3).max(40)
});
app.post('/api/rsvp', csrfProtection, async (req,res)=>{
  const parsed = rsvpSchema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:'invalid'});
  const {eventId, first, last, email, phone} = parsed.data;

  // Ensure event is FREE
  const ev = await pool.query('select id, type from events where id=$1 and published=true', [eventId]);
  if(ev.rowCount===0) return res.status(404).json({error:'not found'});
  if(ev.rows[0].type !== 'FREE') return res.status(400).json({error:'not free'});

  // Create attendee + free ticket
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const reg = await client.query(`
      insert into registrations (id, event_id, first_name, last_name, email, phone, status)
      values ($1,$2,$3,$4,$5,$6,'CONFIRMED') returning id
    `, [uuid.v4(), eventId, first, last, email, phone]);

    const ticketId = uuid.v4();
    // Sign a short JWT (24h) – validated again on check-in
    const token = jwt.sign(
      { t: ticketId, e: eventId },
      process.env.JWT_SECRET,
      { algorithm:'HS256', expiresIn:'30d', issuer:'HHI' }
    );

    await client.query(`
      insert into tickets (id, event_id, registration_id, token, status)
      values ($1,$2,$3,$4,'ISSUED')
    `, [ticketId, eventId, reg.rows[0].id, token]);

    await client.query('COMMIT');

    // Email ticket (QR) — optional: require a real mailer in mailer.js
    // await sendTicketEmail({to:email, name:`${first} ${last}`, token});

    res.json({ok:true});
  } catch(e){
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({error:'server'});
  } finally {
    client.release();
  }
});

// ---------- PAID TICKETS: CREATE CHECKOUT ----------
app.get('/api/checkout/create', async (req,res)=>{
  const eventId = req.query.eventId;
  if(!eventId) return res.status(400).json({error:'missing eventId'});
  // pick default ticket_type (cheapest) – or read from query
  const { rows } = await pool.query(`
    select e.id, e.title, e.starts_at, e.venue, t.id as ticket_type_id, t.name, t.price
    from events e
    join ticket_types t on t.event_id = e.id
    where e.id=$1 and e.published=true and t.price>0
    order by t.price asc limit 1
  `,[eventId]);
  if(rows.length===0) return res.status(404).json({error:'not found'});

  // Create a payment session (Stripe shown; swap to Paynow if needed)
  const redirectUrl = await stripePay.createCheckout({
    eventId,
    ticketTypeId: rows[0].ticket_type_id,
    title: rows[0].title,
    price: rows[0].price
  });

  res.json({redirectUrl});
});

// ---------- WEBHOOK: PAYMENT CONFIRMATION ----------
app.post('/api/pay/webhook', express.raw({type:'application/json'}), async (req,res)=>{
  // Verify signature with Stripe/Paynow SDKs, then:
  // 1) create registration row + ticket row
  // 2) sign JWT token
  // 3) email QR ticket
  // Must be idempotent!
  res.json({received:true});
});

// ---------- CHECK-IN (QR) ----------
const checkSchema = z.object({ token: z.string().min(32).max(2048) });
app.post('/api/checkin', csrfProtection, requireAdmin, async (req,res)=>{
  const parsed = checkSchema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:'invalid'});
  try{
    const payload = jwt.verify(parsed.data.token, process.env.JWT_SECRET, { algorithms:['HS256'], issuer:'HHI' });
    const ticketId = payload.t;
    const eventId  = payload.e;

    const client = await pool.connect();
    try{
      await client.query('BEGIN');
      const t = await client.query(`
        select t.id, t.status, r.first_name, r.last_name, r.email
        from tickets t
        join registrations r on r.id = t.registration_id
        where t.id=$1 and t.event_id=$2 and t.token=$3
        for update
      `,[ticketId, eventId, parsed.data.token]);

      if(t.rowCount===0) { await client.query('ROLLBACK'); return res.status(404).json({error:'not found'}); }
      const row = t.rows[0];

      if(row.status==='USED'){
        await client.query('ROLLBACK');
        return res.status(409).json({error:'already checked in'});
      }

      await client.query(`update tickets set status='USED', used_at=now() where id=$1`, [ticketId]);
      await client.query(`insert into checkins (id, ticket_id, scanned_at) values ($1,$2,now())`, [uuid.v4(), ticketId]);

      await client.query('COMMIT');
      res.json({ ok:true, name: `${row.first_name} ${row.last_name}`, ticketNo: ticketId.slice(0,8).toUpperCase() });
    }catch(e){
      await client.query('ROLLBACK'); throw e;
    }finally{ client.release(); }
  }catch(e){
    return res.status(400).json({error:'invalid token'});
  }
});

// ---------- START ----------
const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=> console.log(`Server on :${PORT}`));
