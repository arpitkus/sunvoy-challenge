import * as dotenv from 'dotenv';
dotenv.config();
import fetch from 'node-fetch';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import * as cheerio from 'cheerio';
import crypto from 'crypto';

const BASE = 'https://challenge.sunvoy.com';
const API = 'https://api.challenge.sunvoy.com';
const EMAIL = process.env.EMAIL!;
const PASSWORD = process.env.PASSWORD!;

const LOGIN_URL    = `${BASE}/login`;
const USERS_API    = `${BASE}/api/users`;
const TOKENS_URL   = `${BASE}/settings/tokens`;
const SETTINGS_API = `${API}/api/settings`;

const COOKIE_STORE = 'cookie-store.json';
const COOKIE_TTL   = 86400;


let cookieJar = '';

function updateCookies(setCookies: string[]) {
  setCookies.forEach(header => {
    const kv = header.split(';')[0] + ';';
    const name = kv.split('=')[0];
    const re = new RegExp(`${name}=[^;]+;`);
    if (cookieJar.match(re)) {
      cookieJar = cookieJar.replace(re, kv);
    } else {
      cookieJar += ' ' + kv;
    }
  });
}

function loadCookies(): boolean {
  if (!existsSync(COOKIE_STORE)) return false;
  try {
    const { cookieJar: saved, created }: { cookieJar: string; created: number } =
      JSON.parse(readFileSync(COOKIE_STORE, 'utf-8'));
    if (Date.now()/1000 - created < COOKIE_TTL) {
      cookieJar = saved;
      console.log(' Using the cookies  FROM the STORE');
      return true;
    }
  } catch {
  }
  return false;
}

function saveCookies() {
  writeFileSync(
    COOKIE_STORE,
    JSON.stringify({ cookieJar, created: Math.floor(Date.now()/1000) }),
    'utf-8'
  );
  console.log('Cookies saved too sttore');
}

//  first task to get the login page by hitting end point
async function getLoginNonce(): Promise<string> {
  const res = await fetch(LOGIN_URL, { method: 'GET' });
  const setCookies = res.headers.raw()['set-cookie'] || [];
  updateCookies(setCookies);

  const html = await res.text();
  const m = html.match(/name="nonce"\s+value="([^"]+)"/);
  if (!m) throw new Error('Could not find nonce in login form');
  return m[1];
}

// making post request now , and also will update cookies 
async function login(nonce: string) {
  const body = new URLSearchParams({
    nonce,
    username: EMAIL,
    password: PASSWORD
  }).toString();

  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieJar.trim()
    },
    body,
    redirect: 'manual'
  });

  const setCookies = res.headers.raw()['set-cookie'] || [];
  updateCookies(setCookies);

  if (res.status !== 302) {
    throw new Error(`Login failed with status ${res.status}`);
  }
}

// get data of all the users which arre 9 usssers
async function fetchUsers(): Promise<any[]> {
  const res = await fetch(USERS_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieJar.trim()
    },
    body: '{}'
  });
  if (!res.ok) throw new Error(`Users fetch failed (${res.status})`);
  const data = await res.json() as any[];
  return data;
}

//  /settings/tokens
async function fetchTokens(): Promise<Record<string,string>> {
  const res = await fetch(TOKENS_URL, {
    method: 'GET',
    headers: { 'Cookie': cookieJar.trim() }
  });
  const html = await res.text();
  const $ = cheerio.load(html);

  const keys = ['access_token','openId','userId','apiuser','operateId','language'] as const;
  const out: Record<string,string> = {};
  keys.forEach(k => {
    const val = $(`input#${k}`).val();
    if (!val || typeof val !== 'string') {
      throw new Error(`Token field "${k}" not found`);
    }
    out[k] = val;
  });
  return out;
}

//  /api/settings
function createSignedRequest(input: Record<string,string>): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params: Record<string,string> = { ...input, timestamp };

  const payload = Object
    .keys(params)
    .sort()
    .map(k => `${k}=${encodeURIComponent(params[k])}`)
    .join('&');

  // secret from site JS
  const SECRET = process.env.SECRET!;
  const hmac = crypto.createHmac('sha1', SECRET);

  hmac.update(payload);
  const checkcode = hmac.digest('hex').toUpperCase();

  return `${payload}&checkcode=${checkcode}`;
}

// current user data 
async function fetchCurrentUser(tokens: Record<string,string>): Promise<{ id: string; firstName: string; lastName: string; email: string }> {
  const body = createSignedRequest(tokens);
  const res = await fetch(SETTINGS_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': BASE,
      'Cookie': cookieJar.trim()
    },
    body
  });
  if (!res.ok) throw new Error(`Current-user fetch failed (${res.status})`);
  const user = await res.json() as { id: string; firstName: string; lastName: string; email: string };
  return user;
}


(async () => {
  try {
    if (!loadCookies()) {
      const nonce = await getLoginNonce();
      console.log('Nonce:', nonce);
      await login(nonce);
      console.log('Logged in. Cookies: are :', cookieJar);
      saveCookies();
    }
    const users = await fetchUsers();
    console.log(`Fetched ${users.length} users`);

    const tokens = await fetchTokens();
    console.log('Tokens parsed:', tokens);

    const current = await fetchCurrentUser(tokens);
    console.log('Current user:', current);

    const all = [...users, current];
    writeFileSync('users.json', JSON.stringify(all, null, 2), 'utf-8');
    console.log(`Successfully wrote ${all.length} entries to users.json`);
  } catch (err) {
    console.error('getting  Error :', err);
  }
})();
