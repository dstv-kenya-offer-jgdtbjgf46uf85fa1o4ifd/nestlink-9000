require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = 'https://automate.nestlink.co.ke/api';
const CLIENT_ID = process.env.NESTLINK_CLIENT_ID;
const API_SECRET = process.env.NESTLINK_API_SECRET;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory status store for batch execution progress
const batchJobs = new Map();

/**
 * Generate HMAC Header Signature for Nestlink API
 */
function generateHeaders(payload) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const idempotencyKey = crypto.randomUUID();
  const bodyString = typeof payload === 'string' ? payload : JSON.stringify(payload);

  const stringToSign = `POST|/v1/stkpush/initiate|${timestamp}|${nonce}|${bodyString}`;
  const signature = crypto
    .createHmac('sha256', API_SECRET || '')
    .update(stringToSign)
    .digest('hex');

  return {
    'Content-Type': 'application/json',
    'X-API-Key': CLIENT_ID,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Idempotency-Key': idempotencyKey,
    'X-Signature': signature
  };
}

/**
 * Delay execution helper
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Queue Processor enforced at 9 requests per minute (~6667 ms delay per item)
 */
async function processBatchQueue(batchId, accountNumber, amount, phoneNumbers) {
  const job = batchJobs.get(batchId);
  const DELAY_MS = 6667; // Enforces 9 requests per minute ceiling

  for (let i = 0; i < phoneNumbers.length; i++) {
    const phone = phoneNumbers[i];
    const payload = { account_number: accountNumber, amount, phone };

    try {
      const headers = generateHeaders(payload);
      const response = await axios.post(`${API_BASE}/v1/stkpush/initiate`, payload, { headers });

      job.logs.push({
        phone,
        status: 'SUCCESS',
        checkout_id: response.data.checkout_id || 'N/A',
        correlation_id: response.data.correlation_id || 'N/A',
        timestamp: new Date().toISOString()
      });
      job.successful++;
    } catch (err) {
      // Safely handle string, object, or standard error responses
      let errorMsg = err.message;
      if (err.response?.data) {
        errorMsg = typeof err.response.data === 'object' 
          ? JSON.stringify(err.response.data) 
          : err.response.data;
      }

      job.logs.push({
        phone,
        status: 'FAILED',
        error: errorMsg,
        timestamp: new Date().toISOString()
      });
      job.failed++;
    }

    job.processed++;

    // Delay following requests to keep strictly within 9 RPM
    if (i < phoneNumbers.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  job.status = 'COMPLETED';
}

// Endpoint to trigger bulk push sequence
app.post('/api/bulk-stkpush', (req, res) => {
  const { account_number, amount, phone_numbers } = req.body;

  if (!account_number || !amount || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
    return res.status(400).json({ error: 'Invalid payload provided. Check account number, amount, and phone list.' });
  }

  const batchId = crypto.randomUUID();
  const job = {
    batchId,
    total: phone_numbers.length,
    processed: 0,
    successful: 0,
    failed: 0,
    status: 'PROCESSING',
    logs: []
  };

  batchJobs.set(batchId, job);

  // Run asynchronously in the background
  processBatchQueue(batchId, account_number, Number(amount), phone_numbers);

  return res.json({ batchId, message: 'Batch queue created successfully' });
});

// Endpoint to poll batch execution log updates
app.get('/api/batch-status/:batchId', (req, res) => {
  const job = batchJobs.get(req.params.batchId);
  if (!job) {
    return res.status(404).json({ error: 'Batch ID not found' });
  }
  return res.json(job);
});

// Catch-all route for unhandled endpoints returning clean JSON errors
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found.` });
});

app.listen(PORT, () => console.log(`Server executing on port ${PORT}`));
