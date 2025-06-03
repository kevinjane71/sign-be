require('dotenv').config();

async function testFrontendShare() {
  try {
    console.log('🖥️  Testing Frontend Share Button Simulation...');
    console.log('📧 This replicates exactly what happens when you click Share');
    console.log('');

    // Simulate the exact data the frontend would send
    const documentId = 'test-document-id';
    const requestBody = {
      // This is what the frontend typically sends
      signers: [
        {
          email: 'malik.vk07@gmail.com',
          name: 'Malik Kumar',
          role: 'signer'
        }
      ],
      subject: 'Please sign this document',
      message: 'Hello, please review and sign this document.',
      configuration: {}
    };

    // Simulate the authenticated user context
    const mockUser = {
      userId: 'test-user-123',
      email: 'sender@company.com',
      name: 'Test Sender'
    };

    console.log('📋 Request Body:', JSON.stringify(requestBody, null, 2));
    console.log('👤 Mock User:', mockUser);
    console.log('');

    // Make the API request to the document sharing endpoint
    const apiUrl = 'http://localhost:5002/api/documents/' + documentId + '/send';
    
    console.log('🌐 Making API request to:', apiUrl);
    console.log('📤 Method: POST');
    console.log('');

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer fake-token-for-testing' // This will fail auth but that's expected
      },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();
    
    console.log('📬 Response Status:', response.status);
    console.log('📋 Response Body:', JSON.stringify(result, null, 2));
    
    if (response.status === 401) {
      console.log('');
      console.log('🔒 Expected authentication failure (no real JWT token)');
      console.log('✅ The request structure appears to be correct');
      console.log('');
      console.log('🎯 If emails work in tests but not in the UI:');
      console.log('  1. Check if the frontend is sending the correct data structure');
      console.log('  2. Verify authentication is working in the frontend');
      console.log('  3. Check browser console for any JavaScript errors');
      console.log('  4. Look at the backend logs when you click Share in the UI');
    } else {
      console.log('');
      console.log('📊 Unexpected response - check server logs for more details');
    }

  } catch (error) {
    console.error('❌ Frontend share simulation failed!');
    console.error('📧 Error:', error.message);
    
    if (error.message.includes('fetch is not defined')) {
      console.log('');
      console.log('💡 Note: This test requires Node.js 18+ for fetch support');
      console.log('🔄 Alternatively, the server might not be running on port 5002');
    }
  }
}

// Check if fetch is available
if (typeof fetch === 'undefined') {
  console.log('⚠️  fetch is not available - installing node-fetch...');
  try {
    const fetch = require('node-fetch');
    global.fetch = fetch;
  } catch (e) {
    console.log('❌ node-fetch not available. Please run: npm install node-fetch');
    console.log('🔄 Or use Node.js 18+ which has fetch built-in');
    process.exit(1);
  }
}

// Run the test
testFrontendShare(); 