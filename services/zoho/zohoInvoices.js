import { zohoRequest } from './zohoClient.js';
import './zohoAuth.js';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { doc, getFirestore, updateDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

function resolveOrganizationId(organizationId) {
  return organizationId || process.env.ZOHO_ORGANIZATION_ID;
}

function getFirebaseDb() {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export function buildZohoInvoicePayload({
  customerId,
  invoiceNumber,
  referenceNumber,
  date,
  dueDate,
  notes,
  terms,
  lineItems = [],
  customFields,
} = {}) {
  if (!customerId) {
    throw new Error('customerId is required to build a Zoho invoice payload.');
  }

  return {
    customer_id: customerId,
    invoice_number: invoiceNumber,
    reference_number: referenceNumber,
    date,
    due_date: dueDate,
    notes,
    terms,
    line_items: lineItems.map((item) => ({
      name: item.name || item.description || 'Line item',
      description: item.description || item.name || '',
      quantity: Number(item.quantity || 1),
      rate: Number(item.rate ?? item.unitPrice ?? item.totalPrice ?? 0),
      item_total: item.itemTotal,
      unit: item.unit,
      tax_id: item.taxId,
      item_id: item.itemId,
    })),
    custom_fields: customFields,
  };
}

export async function createZohoInvoice(invoiceData, { organizationId } = {}) {
  return zohoRequest('post', '/invoices', {
    organization_id: resolveOrganizationId(organizationId),
    body: buildZohoInvoicePayload(invoiceData),
  });
}

export async function updateZohoInvoice(invoiceId, invoiceData, { organizationId } = {}) {
  if (!invoiceId) {
    throw new Error('Zoho invoice ID is required for updates.');
  }

  return zohoRequest('put', `/invoices/${invoiceId}`, {
    organization_id: resolveOrganizationId(organizationId),
    body: buildZohoInvoicePayload(invoiceData),
  });
}

export async function getZohoInvoice(invoiceId, { organizationId } = {}) {
  if (!invoiceId) {
    throw new Error('Zoho invoice ID is required.');
  }

  return zohoRequest('get', `/invoices/${invoiceId}`, {
    organization_id: resolveOrganizationId(organizationId),
  });
}

export async function markZohoInvoiceAsSent(invoiceId, { organizationId } = {}) {
  if (!invoiceId) {
    throw new Error('Zoho invoice ID is required.');
  }

  return zohoRequest('post', `/invoices/${invoiceId}/status/sent`, {
    organization_id: resolveOrganizationId(organizationId),
  });
}

export async function createInvoiceFromJob(job) {
  if (!job?.id) {
    throw new Error('Job ID is required to create and persist a Zoho invoice.');
  }

  if (job.status !== 'Completed') {
    throw new Error('Job must have status "Completed" before an invoice can be created.');
  }

  const zohoContactId = job.client?.zoho_contact_id || job.client?.zohoContactId;
  if (!zohoContactId) {
    throw new Error('Job client must have a zoho_contact_id before invoice creation.');
  }

  try {
    const payload = {
      customerId: zohoContactId,
      lineItems: [
        {
          name: job.description,
          rate: job.total,
          quantity: 1,
        },
      ],
    };

    const response = await createZohoInvoice(payload);
    const zohoInvoiceId =
      response?.invoice?.invoice_id ||
      response?.invoice?.id ||
      response?.invoice_id ||
      null;
    const invoiceNumber =
      response?.invoice?.invoice_number ||
      response?.invoice_number ||
      null;

    if (!zohoInvoiceId) {
      throw new Error('Zoho invoice creation succeeded but no invoice ID was returned.');
    }

    const db = getFirebaseDb();
    await updateDoc(doc(db, 'jobs', job.id), {
      zoho_invoice_id: zohoInvoiceId,
      invoice_number: invoiceNumber,
      status: 'Invoiced',
    });

    console.log('Created Zoho invoice from job:', {
      jobId: job.id,
      zoho_invoice_id: zohoInvoiceId,
      invoice_number: invoiceNumber,
    });

    return {
      ...response,
      zoho_invoice_id: zohoInvoiceId,
      invoice_number: invoiceNumber,
    };
  } catch (error) {
    console.error('Failed to create Zoho invoice from job:', {
      jobId: job?.id,
      status: job?.status,
      clientZohoContactId: zohoContactId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
