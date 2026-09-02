document.getElementById('stkForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = document.getElementById('submitBtn');
  const accountNumber = document.getElementById('accountNumber').value.trim();
  const amount = document.getElementById('amount').value.trim();
  const rawPhones = document.getElementById('phoneNumbers').value.trim();

  const phone_numbers = rawPhones
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0);

  if (phone_numbers.length === 0) return alert('Enter at least one phone number.');

  submitBtn.disabled = true;
  document.getElementById('progressSection').classList.remove('d-none');
  document.getElementById('logList').innerHTML = '';

  try {
    const res = await fetch('/api/bulk-stkpush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_number: accountNumber, amount, phone_numbers })
    });

    // Handle non-JSON HTML/text responses safely without crashing
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const rawText = await res.text();
      throw new Error(`Server returned non-JSON (${res.status}): ${rawText || res.statusText}`);
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to initialize request');

    pollProgress(data.batchId);
  } catch (err) {
    alert('Error: ' + err.message);
    submitBtn.disabled = false;
  }
});

function pollProgress(batchId) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/batch-status/${batchId}`);
      
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Polling returned non-JSON response');
        return;
      }

      const job = await res.json();
      if (!res.ok) throw new Error(job.error || 'Failed to fetch status');

      document.getElementById('counterText').innerText = `Processed ${job.processed} of ${job.total} (Success: ${job.successful}, Failed: ${job.failed})`;
      
      const logList = document.getElementById('logList');
      logList.innerHTML = job.logs.map(log => {
        if (log.status === 'SUCCESS') {
          return `<li class="text-success">[SUCCESS] ${log.phone} - CheckoutID: ${log.checkout_id}</li>`;
        }
        return `<li class="text-danger">[FAILED] ${log.phone} - Error: ${log.error}</li>`;
      }).join('');

      if (job.status === 'COMPLETED') {
        clearInterval(interval);
        document.getElementById('statusBadge').className = 'badge bg-success';
        document.getElementById('statusBadge').innerText = 'COMPLETED';
        document.getElementById('submitBtn').disabled = false;
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 2000);
}
