import express from 'express';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import { createInvoiceFromJob } from './services/zoho/zohoInvoices.js';

const app = express();
const port = Number(process.env.API_PORT || 3001);

app.use(express.json());

function getFirebaseDb() {
  const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
}

async function fetchDocument(collectionName, id) {
  const db = getFirebaseDb();
  const snapshot = await getDoc(doc(db, collectionName, id));

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

app.post('/jobs/:id/create-invoice', async (req, res) => {
  const { id } = req.params;

  try {
    const job = await fetchDocument('jobs', id);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found.',
      });
    }

    const clientId = job.clientId || job.client_id || null;
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'Job is missing a client reference.',
      });
    }

    const client = await fetchDocument('clients', clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found for job.',
      });
    }

    const invoiceResult = await createInvoiceFromJob({
      ...job,
      client,
    });

    return res.status(200).json({
      success: true,
      message: 'Zoho invoice created successfully.',
      jobId: id,
      zoho_invoice_id: invoiceResult.zoho_invoice_id,
      invoice_number: invoiceResult.invoice_number,
    });
  } catch (error) {
    console.error('Create invoice endpoint failed:', {
      jobId: id,
      message: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create Zoho invoice.',
    });
  }
});

app.listen(port, () => {
  console.log(`API server listening on http://127.0.0.1:${port}`);
});
