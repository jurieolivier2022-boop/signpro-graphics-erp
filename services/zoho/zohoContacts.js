import { zohoRequest } from './zohoClient.js';
import './zohoAuth.js';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { addDoc, collection, doc, getDocs, getFirestore, query, updateDoc, where } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

function resolveOrganizationId(organizationId) {
  return organizationId || process.env.ZOHO_ORGANIZATION_ID;
}

function getFirebaseDb() {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

function toTimestamp(value) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getLocalModifiedTimestamp(client = {}) {
  return Math.max(
    Number(client.updatedAt || 0),
    Number(client.modifiedAt || 0),
    Number(client.createdAt || 0),
    toTimestamp(client.zoho_last_modified_time)
  );
}

function mapZohoContactToClient(contact = {}) {
  return {
    name: contact.contact_name || contact.contact_persons?.[0]?.first_name || '',
    email: contact.email || contact.contact_persons?.[0]?.email || '',
    zoho_contact_id: contact.contact_id,
    zoho_last_modified_time: contact.last_modified_time || null,
    updatedAt: Date.now(),
  };
}

export function buildZohoContactPayload(client = {}) {
  return {
    contact_name: client.name || '',
    email: client.email || '',
    contact_type: 'customer',
  };
}

export async function listZohoContacts({ organizationId, params = {} } = {}) {
  return zohoRequest('get', '/contacts', {
    organization_id: resolveOrganizationId(organizationId),
    params,
  });
}

export async function findZohoContactByEmail(email, { organizationId } = {}) {
  if (!email) {
    return null;
  }

  const response = await listZohoContacts({
    organizationId,
    params: {
      email_contains: email,
    },
  });

  return response.contacts?.find((contact) => {
    const primaryEmail = contact.email || contact.contact_persons?.[0]?.email;
    return primaryEmail?.toLowerCase() === email.toLowerCase();
  }) || null;
}

export async function createZohoContact(client, { organizationId } = {}) {
  return zohoRequest('post', '/contacts', {
    organization_id: resolveOrganizationId(organizationId),
    body: buildZohoContactPayload(client),
  });
}

export async function updateZohoContact(contactId, client, { organizationId } = {}) {
  if (!contactId) {
    throw new Error('Zoho contact ID is required for updates.');
  }

  return zohoRequest('put', `/contacts/${contactId}`, {
    organization_id: resolveOrganizationId(organizationId),
    body: buildZohoContactPayload(client),
  });
}

async function saveZohoContactIdInDatabase(clientId, zohoContactId) {
  if (!clientId) {
    throw new Error('Client ID is required to save zoho_contact_id in the database.');
  }

  if (!zohoContactId) {
    throw new Error('Zoho contact ID is required to persist contact sync results.');
  }

  const db = getFirebaseDb();
  await updateDoc(doc(db, 'clients', clientId), {
    zoho_contact_id: zohoContactId,
  });
}

export async function syncClientToZoho(client) {
  if (!client?.id) {
    throw new Error('Client record must include an id before Zoho sync can persist results.');
  }

  if (!client?.name && !client?.email) {
    throw new Error('Client record must include at least a name or email for Zoho sync.');
  }

  try {
    const zohoContactId = client.zoho_contact_id || client.zohoContactId || null;
    const response = zohoContactId
      ? await updateZohoContact(zohoContactId, client)
      : await createZohoContact(client);

    const savedZohoContactId =
      response?.contact?.contact_id ||
      response?.contact?.id ||
      response?.contact_id ||
      zohoContactId;

    if (!savedZohoContactId) {
      throw new Error('Zoho contact sync succeeded but no contact ID was returned.');
    }

    await saveZohoContactIdInDatabase(client.id, savedZohoContactId);

    console.log('Zoho client sync successful:', {
      clientId: client.id,
      zoho_contact_id: savedZohoContactId,
      action: zohoContactId ? 'update' : 'create',
    });

    return {
      ...response,
      zoho_contact_id: savedZohoContactId,
    };
  } catch (error) {
    console.error('Failed to sync client to Zoho:', {
      clientId: client?.id,
      clientName: client?.name,
      clientEmail: client?.email,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function findLocalClientByZohoContactId(zohoContactId) {
  if (!zohoContactId) {
    return null;
  }

  const db = getFirebaseDb();
  const snapshot = await getDocs(
    query(collection(db, 'clients'), where('zoho_contact_id', '==', zohoContactId))
  );

  if (snapshot.empty) {
    return null;
  }

  const match = snapshot.docs[0];
  return {
    id: match.id,
    ...match.data(),
  };
}

export async function syncClientsFromZoho() {
  try {
    const response = await listZohoContacts();
    const contacts = response?.contacts || [];
    const db = getFirebaseDb();
    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };

    for (const contact of contacts) {
      try {
        const zohoContactId = contact.contact_id;
        const localClient = await findLocalClientByZohoContactId(zohoContactId);
        const zohoModifiedAt = toTimestamp(contact.last_modified_time);
        const mappedClient = mapZohoContactToClient(contact);

        if (localClient) {
          const localModifiedAt = getLocalModifiedTimestamp(localClient);
          if (localModifiedAt > zohoModifiedAt && zohoModifiedAt > 0) {
            results.skipped += 1;
            console.log('Skipped Zoho contact because local client is newer:', {
              clientId: localClient.id,
              zoho_contact_id: zohoContactId,
              localModifiedAt,
              zohoModifiedAt,
            });
            continue;
          }

          await updateDoc(doc(db, 'clients', localClient.id), mappedClient);
          results.updated += 1;
          console.log('Updated local client from Zoho:', {
            clientId: localClient.id,
            zoho_contact_id: zohoContactId,
          });
          continue;
        }

        await addDoc(collection(db, 'clients'), {
          ...mappedClient,
          createdAt: Date.now(),
        });
        results.created += 1;
        console.log('Created local client from Zoho:', {
          zoho_contact_id: zohoContactId,
          email: mappedClient.email,
        });
      } catch (error) {
        results.errors += 1;
        console.error('Failed to sync Zoho contact into local database:', {
          zoho_contact_id: contact?.contact_id,
          contact_name: contact?.contact_name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  } catch (error) {
    console.error('Failed to sync clients from Zoho:', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function syncZohoContact(client, options = {}) {
  if (!client?.email && !client?.companyName && !client?.name) {
    throw new Error('Client record is missing the data required for Zoho contact sync.');
  }

  const existingContact = client.zohoContactId
    ? { contact_id: client.zohoContactId }
    : await findZohoContactByEmail(client.email, options);

  if (existingContact?.contact_id) {
    return updateZohoContact(existingContact.contact_id, client, options);
  }

  return createZohoContact(client, options);
}
