import { setZohoAccessTokenProvider, zohoRequestRaw } from './zohoClient.js';

const DEFAULT_ACCOUNTS_BASE_URL = process.env.ZOHO_ACCOUNTS_BASE_URL || 'https://accounts.zoho.com';

const tokenStore = {
  access_token: null,
  refresh_token: process.env.REFRESH_TOKEN || process.env.ZOHO_REFRESH_TOKEN || null,
  expires_at: 0,
  token_type: 'Bearer',
};

function getEnv(name, fallbackName) {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : undefined);
  if (!value) {
    return null;
  }
  return value;
}

function getRequiredEnv(name, fallbackName) {
  const value = getEnv(name, fallbackName);
  if (!value) {
    throw new Error(`Missing required Zoho environment variable: ${name}`);
  }
  return value;
}

export function clearZohoTokenCache() {
  tokenStore.access_token = null;
  tokenStore.refresh_token = getEnv('REFRESH_TOKEN', 'ZOHO_REFRESH_TOKEN');
  tokenStore.expires_at = 0;
  tokenStore.token_type = 'Bearer';
}

export function getZohoTokenState() {
  return { ...tokenStore };
}

function isTokenExpired() {
  if (!tokenStore.access_token || !tokenStore.expires_at) {
    return true;
  }

  return Date.now() >= tokenStore.expires_at;
}

function storeTokenData(tokenData = {}) {
  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token || tokenStore.refresh_token || getEnv('REFRESH_TOKEN', 'ZOHO_REFRESH_TOKEN');
  const expiresIn = Number(tokenData.expires_in ?? tokenData.expires_in_sec ?? 3600);

  if (!accessToken) {
    throw new Error('Zoho token response did not include an access_token.');
  }

  tokenStore.access_token = accessToken;
  tokenStore.refresh_token = refreshToken;
  tokenStore.token_type = tokenData.token_type || tokenStore.token_type || 'Bearer';
  tokenStore.expires_at = Date.now() + Math.max(expiresIn - 60, 0) * 1000;

  return tokenStore.access_token;
}

export function buildZohoAuthorizationUrl({
  scope = 'ZohoBooks.fullaccess.all',
  accessType = 'offline',
  prompt = 'consent',
  state,
} = {}) {
  const clientId = getRequiredEnv('CLIENT_ID', 'ZOHO_CLIENT_ID');
  const redirectUri = getRequiredEnv('ZOHO_REDIRECT_URI');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    access_type: accessType,
    prompt,
  });

  if (state) {
    params.set('state', state);
  }

  return `${DEFAULT_ACCOUNTS_BASE_URL}/oauth/v2/auth?${params.toString()}`;
}

export async function exchangeAuthorizationCode(code) {
  if (!code) {
    throw new Error('Authorization code is required.');
  }

  const clientId = getRequiredEnv('CLIENT_ID', 'ZOHO_CLIENT_ID');
  const clientSecret = getRequiredEnv('CLIENT_SECRET', 'ZOHO_CLIENT_SECRET');
  const redirectUri = getRequiredEnv('ZOHO_REDIRECT_URI');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const response = await zohoRequestRaw({
    method: 'post',
    baseURL: DEFAULT_ACCOUNTS_BASE_URL,
    url: '/oauth/v2/token',
    data: params,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  storeTokenData(response.data);
  return getZohoTokenState();
}

export async function refreshZohoAccessToken() {
  const clientId = getRequiredEnv('CLIENT_ID', 'ZOHO_CLIENT_ID');
  const clientSecret = getRequiredEnv('CLIENT_SECRET', 'ZOHO_CLIENT_SECRET');
  const refreshToken = tokenStore.refresh_token || getRequiredEnv('REFRESH_TOKEN', 'ZOHO_REFRESH_TOKEN');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await zohoRequestRaw({
    method: 'post',
    baseURL: DEFAULT_ACCOUNTS_BASE_URL,
    url: '/oauth/v2/token',
    data: params,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  return storeTokenData({
    ...response.data,
    refresh_token: response.data?.refresh_token || refreshToken,
  });
}

export async function getZohoAccessToken() {
  if (!isTokenExpired()) {
    return tokenStore.access_token;
  }

  return refreshZohoAccessToken();
}

setZohoAccessTokenProvider(getZohoAccessToken);
