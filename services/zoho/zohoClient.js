import axios from 'axios';

const DEFAULT_API_BASE_URL = process.env.ZOHO_API_BASE_URL || 'https://www.zohoapis.com/books/v3';

let accessTokenProvider = null;

const client = axios.create({
  baseURL: DEFAULT_API_BASE_URL,
  timeout: 30000,
});

export function configureZohoClient(config = {}) {
  Object.assign(client.defaults, config);
  return client;
}

export function setZohoAccessTokenProvider(provider) {
  accessTokenProvider = provider;
}

function getOrganizationId() {
  return process.env.ZOHO_ORGANIZATION_ID || process.env.ORGANIZATION_ID || null;
}

async function buildAuthHeaders() {
  if (!accessTokenProvider) {
    throw new Error('Zoho access token provider has not been registered.');
  }

  const accessToken = await accessTokenProvider();
  if (!accessToken) {
    throw new Error('Zoho access token provider returned an empty token.');
  }

  return {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

export async function zohoRequest(method, endpoint, data = {}) {
  if (!method || !endpoint) {
    throw new Error('zohoRequest requires both method and endpoint.');
  }

  const normalizedMethod = method.toLowerCase();
  const organizationId = data.organization_id || getOrganizationId();
  const headers = await buildAuthHeaders();
  const requestConfig = {
    method: normalizedMethod,
    url: endpoint,
    headers,
  };

  if (normalizedMethod === 'get' || normalizedMethod === 'delete') {
    requestConfig.params = {
      ...(data.params || {}),
      ...(organizationId ? { organization_id: organizationId } : {}),
    };
  } else {
    requestConfig.params = organizationId ? { organization_id: organizationId } : {};
    requestConfig.data = data.body ?? data;
  }

  try {
    const response = await client.request(requestConfig);
    console.log('Zoho API response:', {
      method: normalizedMethod,
      endpoint,
      status: response.status,
      organizationId,
    });
    return response.data;
  } catch (error) {
    const responseData = error.response?.data;
    console.error('Zoho API error:', {
      method: normalizedMethod,
      endpoint,
      status: error.response?.status,
      organizationId,
      response: responseData,
      message: error.message,
    });
    throw error;
  }
}

export async function zohoRequestRaw(options) {
  return client.request(options);
}

export default client;
