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
(async () => {
  try {
    if (!loadCookies()) {
      const nonce = await getLoginNonce();
      console.log('Nonce:', nonce);
      await login(nonce);
      console.log('Logged in. Cookies: are :', cookieJar);
      saveCookies();
    }
    const users   = await fetchUsers();
    console.log(`Fetched ${users.length} users`);

    writeFileSync('users.json', JSON.stringify(users, null, 2), 'utf-8');
    console.log(`Successfully wrote ${users.length} entries to users.json`);
  } catch (err) {
    console.error('getting  Error :', err);
  }
})();
